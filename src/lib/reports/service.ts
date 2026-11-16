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

/**
 * Generates server-side report ID: "HZ-" + 8 uppercase base32/hex chars.
 */
export function generateReportId(): string {
  return "HZ-" + crypto.randomBytes(4).toString("hex").toUpperCase();
}

/**
 * Server-only function to list all reports with their joined ward,
 * mapped to the exact ClientReport DTO shape.
 */
export async function listReports(): Promise<ClientReport[]> {
  const rows = await prisma.report.findMany({
    orderBy: { createdAt: "desc" },
    include: { ward: true },
  });

  return rows.map(toReportDTO);
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
}

/**
 * Core shared report creation logic:
 * 1. Runs hazard extraction
 * 2. Resolves coordinates (with landmark fallback)
 * 3. Derives actionRequired with deterministic municipal rules
 * 4. Tags ward via PostGIS tagWardDb
 * 5. Generates unique report ID ("HZ-" + 8 random hex chars) with up to 3 retries on P2002 collision
 * 6. Persists to Postgres (isSynthetic = false)
 * 7. Returns client Report DTO + diagnostic metadata
 */
export async function createReportRecord(input: CreateReportRecordInput): Promise<CreateReportRecordResult> {
  const extraction = await extractHazard(input.text);
  const coords = resolveCoordinates({ lat: input.lat, lng: input.lng, rawLocation: extraction.raw_location });
  const actionRequired = getActionRequired(extraction.hazard_category, extraction.severity_level);

  // Tag ward using PostGIS ST_Covers
  let wardDbId: string | null = null;
  if (coords) {
    const wardTag = await tagWardDb(coords.lat, coords.lng);
    if (wardTag.status === "matched") {
      wardDbId = wardTag.db_id;
    }
  }

  // Retry up to 3 times on P2002 unique constraint collision
  let attempts = 0;
  const maxAttempts = 3;
  let savedReport = null;

  while (attempts < maxAttempts) {
    attempts++;
    const reportId = generateReportId();

    try {
      savedReport = await prisma.report.create({
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

  if (!savedReport) {
    throw new Error("Could not create report record.");
  }

  const clientReport = toReportDTO(savedReport);

  return {
    report: clientReport,
    transcript: input.text,
    transcript_english: extraction.translated_english ?? null,
    transcript_mock: input.isMockTranscript ?? false,
    degraded: extraction.degraded || false,
    degraded_reason: extraction.errorReason || null,
  };
}
