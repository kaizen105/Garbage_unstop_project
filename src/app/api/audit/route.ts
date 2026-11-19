import { NextResponse } from "next/server";
import { connection } from "next/server";
import { runAudit, runAuditFromCluster } from "@/lib/audit/audit";
import { findLargestAnomalyFromDb } from "@/lib/audit/dbAnomaly";
import { getAsOf } from "@/lib/asOf";
import { z } from "zod";
import { tagWard } from "@/lib/spatial/wards";

const AuditRequestSchema = z.object({
  reports: z.array(z.object({
    ward_id: z.string().max(100).optional(),
    hazard_category: z.string().max(100),
    createdAt: z.string().max(100),
    lat: z.number().min(-90).max(90).optional(),
    lng: z.number().min(-180).max(180).optional()
  })).max(500).optional()
}).optional();

export async function POST(request: Request) {
  await connection();
  try {
    let json: unknown = {};
    const text = await request.text();
    if (text.trim().length > 0) {
      try {
        json = JSON.parse(text);
      } catch {
        return NextResponse.json(
          { error: "VALIDATION_ERROR", message: "Invalid payload" },
          { status: 400 }
        );
      }
    }

    const parseResult = AuditRequestSchema.safeParse(json);
    if (!parseResult.success) {
      return NextResponse.json(
        { error: "VALIDATION_ERROR", message: "Invalid payload" },
        { status: 400 }
      );
    }
    const parsed = parseResult.data;

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
    const asOf = await getAsOf();
    const cluster = await findLargestAnomalyFromDb(asOf);
    const result = await runAuditFromCluster(cluster);
    return NextResponse.json(result);
  } catch (error: unknown) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: "VALIDATION_ERROR", message: "Invalid payload" },
        { status: 400 }
      );
    }
    console.error("[API audit POST error]:", error);
    return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 });
  }
}
