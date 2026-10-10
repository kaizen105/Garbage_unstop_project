import { NextResponse } from "next/server";
import { runAudit } from "@/lib/audit/audit";
import { z } from "zod";

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
    const result = await runAudit(reports);
    return NextResponse.json(result);
  } catch {
    return NextResponse.json({ error: "INTERNAL_ERROR" }, { status: 500 });
  }
}
