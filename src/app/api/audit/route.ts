import { NextResponse } from "next/server";
import { connection } from "next/server";
import { runAudit, runAuditFromCluster } from "@/lib/audit/audit";
import { findLargestAnomalyFromDb } from "@/lib/audit/dbAnomaly";
import { z } from "zod";
import { tagWard } from "@/lib/spatial/wards";

const AuditRequestSchema = z.object({
  reports: z.array(z.object({
    ward_id: z.string().optional(),
    hazard_category: z.string(),
    createdAt: z.string(),
    lat: z.number().optional(),
    lng: z.number().optional()
  })).max(500).optional()
}).optional();

export async function POST(request: Request) {
  await connection();
  try {
    let json: unknown = {};
    try {
      json = await request.json();
    } catch {
      json = {};
    }

    const parsed = AuditRequestSchema.parse(json);

    // If explicit reports array is supplied (<= 500 reports, e.g. from unit/integration tests)
    if (parsed?.reports && parsed.reports.length > 0) {
      const taggedReports = parsed.reports.map(r => {
        if (r.ward_id) return r;
        const tag = tagWard(r.lat && r.lng ? { lat: r.lat, lng: r.lng } : null);
        return {
          ...r,
          ward_id: tag.status === "matched" ? tag.ward_name : undefined
        };
      });

      const result = await runAudit(taggedReports);
      return NextResponse.json(result);
    }

    // Default bounded SQL path when body has no reports: queries DB directly
    const cluster = await findLargestAnomalyFromDb(new Date());
    const result = await runAuditFromCluster(cluster);
    return NextResponse.json(result);
  } catch (error: unknown) {
    console.error("[API audit POST error]:", error);
    return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 });
  }
}
