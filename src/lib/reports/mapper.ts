import type { Report as PrismaReport, Ward } from "@prisma/client";
import type { Report as ClientReport } from "@/lib/store/reports";
import type { WardTag } from "@/lib/validation/schemas";

export type PrismaReportWithWard = PrismaReport & {
  ward: Ward | null;
};

/**
 * Pure function mapping a Prisma Report row (with optional joined Ward)
 * to the EXACT client-side Report shape.
 */
export function toReportDTO(row: PrismaReportWithWard): ClientReport {
  let wardTag: WardTag = {
    status: "unmapped",
    ward_id: null,
    ward_name: null,
  };

  if (row.ward) {
    // externalId is `${ward_id}-${slugWardName(ward_name)}`
    // Extract original ward_id prefix for backwards compatibility with map GeoJSON matching
    const dashIdx = row.ward.externalId.indexOf("-");
    const originalWardId = dashIdx !== -1 ? row.ward.externalId.substring(0, dashIdx) : row.ward.externalId;

    wardTag = {
      status: "matched",
      ward_id: originalWardId,
      ward_name: row.ward.name,
      external_id: row.ward.externalId,
    };
  }

  const coordinates =
    row.lat !== null && row.lng !== null && !isNaN(row.lat) && !isNaN(row.lng)
      ? { lat: row.lat, lng: row.lng }
      : null;

  return {
    report_id: row.id,
    hazard_category: row.hazardCategory,
    severity_level: row.severityLevel,
    raw_location: row.rawLocation,
    coordinates,
    action_required: row.actionRequired,
    ward: wardTag,
    createdAt: row.createdAt.toISOString(),
    transcript: row.transcript,
    translated_english: row.translatedEnglish ?? null,
  };
}
