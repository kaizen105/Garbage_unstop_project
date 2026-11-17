"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { prisma } from "@/lib/db/prisma";
import { createReportRecord } from "@/lib/reports/service";
import { checkRateLimit, extractClientIp } from "@/lib/rateLimit";
import type { Report as ClientReport } from "@/lib/store/reports";
import type { PipelineTrace } from "@/lib/trace";
import { seedReports } from "@/data/seed_reports";
import { tagWardDb } from "@/lib/spatial/wardsDb";
import { HazardCategory, ActionRequired, ReportStatus } from "@prisma/client";

const SubmitReportInputSchema = z.object({
  text: z.string().trim().min(1, "Text cannot be empty").max(2000, "Text cannot exceed 2000 characters"),
  lat: z.number().min(-90).max(90).optional(),
  lng: z.number().min(-180).max(180).optional(),
});

export type SubmitReportInput = z.infer<typeof SubmitReportInputSchema>;

export type ServerActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string };

/**
 * Server Action to submit a report via text + optional lat/lng.
 * Performs strict Zod boundary validation.
 * Extracts hazard, resolves coordinates, derives actionRequired deterministically,
 * tags ward, and persists with isSynthetic=false.
 * Revalidates "/".
 */
export async function submitReport(rawInput: unknown): Promise<ServerActionResult<{ report: ClientReport; trace: PipelineTrace }>> {
  try {
    const headerList = await headers();
    const clientIp = extractClientIp(headerList);
    const rateLimit = await checkRateLimit(clientIp);
    if (!rateLimit.allowed) {
      return {
        ok: false,
        error: `Rate limit exceeded. Please wait ${rateLimit.retryAfterSeconds} seconds before submitting another report.`,
      };
    }

    const parseResult = SubmitReportInputSchema.safeParse(rawInput);
    if (!parseResult.success) {
      const firstIssue = parseResult.error.issues[0]?.message ?? "Invalid report input";
      return { ok: false, error: firstIssue };
    }

    const { text, lat, lng } = parseResult.data;

    const result = await createReportRecord({
      text,
      lat,
      lng,
      isMockTranscript: false,
    });

    revalidatePath("/");
    return { ok: true, data: { report: result.report, trace: result.trace } };
  } catch (err: unknown) {
    console.error("[submitReport Action Error]:", err);
    return { ok: false, error: "Failed to submit report. Please try again." };
  }
}

/**
 * Server Action to reset synthetic demo data.
 * Disabled unless process.env.ENABLE_DEMO_RESET === "true".
 * Deletes ONLY rows where isSynthetic = true and reseeds the 60 seed rows inside a single transaction.
 * Real reports (isSynthetic = false) are never deleted.
 */

/**
 * Pure function returning Prisma delete filter for synthetic demo reports.
 * Deletes only rows where isSynthetic is true and id starts with 'HZ-'.
 * Protects 10k synthetic batches ('SYN-') and live reports from deletion.
 */
export async function buildDemoResetDeleteWhere() {
  return {
    isSynthetic: true,
    id: {
      startsWith: "HZ-",
    },
  };
}

export async function resetSyntheticData(): Promise<ServerActionResult<{ count: number }>> {
  try {
    if (process.env.ENABLE_DEMO_RESET !== "true") {
      return { ok: false, error: "Demo reset is disabled in this environment." };
    }

    // Load ward lookup
    const allWards = await prisma.ward.findMany({
      select: { id: true, externalId: true },
    });
    const wardByExternalId = new Map<string, string>();
    for (const w of allWards) {
      wardByExternalId.set(w.externalId, w.id);
    }

    const deleteWhere = await buildDemoResetDeleteWhere();

    await prisma.$transaction(async (tx) => {
      // 1. Delete ONLY synthetic demo reports (HZ- prefix)
      await tx.report.deleteMany({
        where: deleteWhere,
      });

      // 2. Reseed the 60 seed reports
      for (const rep of seedReports) {
        let resolvedWardDbId: string | null = null;
        if (rep.coordinates) {
          const tag = await tagWardDb(rep.coordinates.lat, rep.coordinates.lng);
          if (tag.status === "matched") {
            resolvedWardDbId = tag.db_id;
          }
        }

        const hazardCat = rep.hazard_category as HazardCategory;
        const actionReq = rep.action_required as ActionRequired;
        const createdAtDate = rep.createdAt ? new Date(rep.createdAt) : new Date();
        const lat = rep.coordinates ? rep.coordinates.lat : null;
        const lng = rep.coordinates ? rep.coordinates.lng : null;
        const transcriptText = rep.transcript || "";

        await tx.report.upsert({
          where: { id: rep.report_id },
          create: {
            id: rep.report_id,
            hazardCategory: hazardCat,
            severityLevel: rep.severity_level,
            rawLocation: rep.raw_location,
            lat,
            lng,
            transcript: transcriptText,
            transcriptMock: true,
            actionRequired: actionReq,
            status: ReportStatus.OPEN,
            isSynthetic: true,
            wardId: resolvedWardDbId,
            createdAt: createdAtDate,
          },
          update: {
            hazardCategory: hazardCat,
            severityLevel: rep.severity_level,
            rawLocation: rep.raw_location,
            lat,
            lng,
            transcript: transcriptText,
            transcriptMock: true,
            actionRequired: actionReq,
            status: ReportStatus.OPEN,
            isSynthetic: true,
            wardId: resolvedWardDbId,
            createdAt: createdAtDate,
          },
        });
      }
    }, {
      timeout: 60000,
    });

    revalidatePath("/");
    return { ok: true, data: { count: seedReports.length } };
  } catch (err: unknown) {
    console.error("[resetSyntheticData Action Error]:", err);
    return { ok: false, error: "Failed to reset synthetic data." };
  }
}
