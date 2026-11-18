import "server-only";
import { prisma } from "@/lib/db/prisma";
import { toReportDTO } from "./mapper";
import type { Report as ClientReport } from "@/lib/store/reports";
import { HazardCategory, ActionRequired, ReportStatus, Prisma } from "@prisma/client";
import { extractHazard } from "@/lib/llm/extract";
import { resolveCoordinates } from "@/lib/spatial/locate";
import { tagWardDb } from "@/lib/spatial/wardsDb";
import { getActionRequired } from "@/app/api/report/route";
import * as crypto from "crypto";
import { z } from "zod";
import { PipelineTrace, TraceStage, timeStage } from "@/lib/trace";

/**
 * Generates server-side report ID: "HZ-" + 8 uppercase base32/hex chars.
 */
export function generateReportId(): string {
  return "HZ-" + crypto.randomBytes(4).toString("hex").toUpperCase();
}

export const ListReportsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: z.string().max(64).regex(/^[A-Za-z0-9_-]+$/).optional(),
});
export type ListReportsOptions = z.infer<typeof ListReportsQuerySchema>;

/**
 * Server-only function to list reports with limit and cursor,
 * ordered by createdAt desc, id desc. Default limit 50, max 200.
 */
export async function listReports(options?: ListReportsOptions): Promise<ClientReport[]> {
  const parsed = ListReportsQuerySchema.safeParse(options ?? {});
  const { limit, cursor } = parsed.success ? parsed.data : { limit: 50, cursor: undefined };

  const rows = await prisma.report.findMany({
    take: limit,
    skip: cursor ? 1 : 0,
    cursor: cursor ? { id: cursor } : undefined,
    orderBy: [
      { createdAt: "desc" },
      { id: "desc" },
    ],
    include: { ward: true },
  });

  return rows.map(toReportDTO);
}

/**
 * Fetches a single report by ID with its joined ward relation.
 */
export async function getReportById(id: string): Promise<ClientReport | null> {
  const row = await prisma.report.findUnique({
    where: { id },
    include: { ward: true },
  });

  return row ? toReportDTO(row) : null;
}

export interface CreateReportRecordInput {
  text: string;
  lat?: number;
  lng?: number;
  isMockTranscript?: boolean;
}

export interface CreateReportRecordResult {
  report: ClientReport;
  transcript: string;
  transcript_english: string | null;
  transcript_mock: boolean;
  degraded: boolean;
  degraded_reason: string | null;
  trace: PipelineTrace;
}

/**
 * Core shared report creation logic:
 * 1. Runs hazard extraction
 * 2. Resolves coordinates (with landmark fallback)
 * 3. Derives actionRequired with deterministic municipal rules
 * 4. Tags ward via PostGIS tagWardDb
 * 5. Generates unique report ID ("HZ-" + 8 random hex chars) with up to 3 retries on P2002 collision
 * 6. Persists to Postgres (isSynthetic = false)
 * 7. Returns client Report DTO + diagnostic metadata + pipeline trace
 */
export async function createReportRecord(input: CreateReportRecordInput): Promise<CreateReportRecordResult> {
  const stages: TraceStage[] = [];
  const pipelineStart = performance.now();

  const extraction = await timeStage(
    stages,
    "LLM extraction",
    () => extractHazard(input.text),
    (res) => (res.degraded ? `Degraded (${res.errorReason || "fallback"})` : "Nominal")
  );

  const coords = await timeStage(
    stages,
    "Coordinate resolution",
    () => resolveCoordinates({ lat: input.lat, lng: input.lng, rawLocation: extraction.raw_location }),
    (res) => (res ? `Source: ${res.source}` : "Unresolved")
  );

  let wardDbId: string | null = null;
  if (coords) {
    const wardTag = await timeStage(
      stages,
      "Ward tagging",
      () => tagWardDb(coords.lat, coords.lng),
      (res) => (res.status === "matched" ? res.ward_name : `Status: ${res.status}`)
    );
    if (wardTag.status === "matched") {
      wardDbId = wardTag.db_id;
    }
  }

  const actionRequired = await timeStage(
    stages,
    "Dispatch rule",
    () => getActionRequired(extraction.hazard_category, extraction.severity_level),
    (res) => res
  );

  // Retry up to 3 times on P2002 unique constraint collision
  const savedReport = await timeStage(
    stages,
    "Database write",
    async () => {
      let attempts = 0;
      const maxAttempts = 3;
      let created = null;

      while (attempts < maxAttempts) {
        attempts++;
        const reportId = generateReportId();

        try {
          created = await prisma.report.create({
            data: {
              id: reportId,
              hazardCategory: extraction.hazard_category as HazardCategory,
              severityLevel: extraction.severity_level,
              rawLocation: extraction.raw_location,
              lat: coords?.lat ?? null,
              lng: coords?.lng ?? null,
              transcript: input.text,
              transcriptMock: input.isMockTranscript ?? false,
              translatedEnglish: extraction.translated_english ?? null,
              actionRequired: actionRequired as ActionRequired,
              status: ReportStatus.OPEN,
              isSynthetic: false,
              wardId: wardDbId,
            },
            include: { ward: true },
          });
          break;
        } catch (err: unknown) {
          if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
            if (attempts >= maxAttempts) {
              throw new Error("Failed to generate unique report ID after 3 attempts.");
            }
            continue;
          }
          throw err;
        }
      }

      if (!created) {
        throw new Error("Failed to save report to database.");
      }
      return created;
    }
  );

  const totalMs = Math.round((performance.now() - pipelineStart) * 10) / 10;
  const coordinateSource = coords ? coords.source : "unresolved";

  return {
    report: toReportDTO(savedReport),
    transcript: input.text,
    transcript_english: extraction.translated_english ?? null,
    transcript_mock: input.isMockTranscript ?? false,
    degraded: extraction.degraded ?? false,
    degraded_reason: extraction.errorReason ?? null,
    trace: {
      stages,
      totalMs,
      coordinateSource,
    },
  };
}
