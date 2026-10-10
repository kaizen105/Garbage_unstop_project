import { NextResponse } from "next/server";
import { runAudit } from "@/lib/audit/audit";
import { z } from "zod";
import { tagWard } from "@/lib/spatial/wards";

const AuditRequestSchema = z.object({
  reports: z.array(z.object({
    ward_id: z.string().optional(),
    hazard_category: z.string(),
    createdAt: z.string(),
    lat: z.number().optional(),
    lng: z.number().optional()
  })).max(500)
});

export async function POST(request: Request) {
  try {
    const json = await request.json();
    const { reports } = AuditRequestSchema.parse(json);
    
    const taggedReports = reports.map(r => {
      if (r.ward_id) return r;
      const tag = tagWard(r.lat && r.lng ? { lat: r.lat, lng: r.lng } : null);
      return {
        ...r,
        ward_id: tag.status === "matched" ? tag.ward_name : undefined
      };
    });

    const result = await runAudit(taggedReports);
    return NextResponse.json(result);
  } catch {
    return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 });
  }
}
