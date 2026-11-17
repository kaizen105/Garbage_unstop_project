import { NextResponse } from "next/server";
import { connection } from "next/server";
import { prisma } from "@/lib/db/prisma";
import { Prisma } from "@prisma/client";

export interface StatsResponse {
  total: number;
  high_severity_count: number;
  average_severity: number;
  hazmat_count: number;
  estimated_prevented: number;
}

interface StatsRawRow {
  total: number;
  high_severity_count: number;
  average_severity: number;
  hazmat_count: number;
  estimated_prevented: string | number;
}

export async function GET() {
  await connection();
  try {
    const rows = await prisma.$queryRaw<StatsRawRow[]>(Prisma.sql`
      SELECT
        COUNT(*)::int AS total,
        COUNT(CASE WHEN "severityLevel" >= 7 THEN 1 END)::int AS high_severity_count,
        COALESCE(AVG("severityLevel"), 0)::float8 AS average_severity,
        COUNT(CASE WHEN "actionRequired" = 'dispatch_hazmat_bypass_standard' THEN 1 END)::int AS hazmat_count,
        COALESCE(SUM(
          CASE
            WHEN "actionRequired" <> 'routine_collection' THEN
              CASE "hazardCategory"
                WHEN 'biohazard_medical' THEN 85000 * ("severityLevel"::float8 / 10.0)
                WHEN 'chemical' THEN 120000 * ("severityLevel"::float8 / 10.0)
                WHEN 'electrical_hazard' THEN 60000 * ("severityLevel"::float8 / 10.0)
                WHEN 'construction_debris' THEN 40000 * ("severityLevel"::float8 / 10.0)
                WHEN 'general_overflow' THEN 5000 * ("severityLevel"::float8 / 10.0)
                ELSE 10000 * ("severityLevel"::float8 / 10.0)
              END
            ELSE 0
          END
        ), 0)::bigint AS estimated_prevented
      FROM "Report"
    `);

    const row = rows[0] ?? {
      total: 0,
      high_severity_count: 0,
      average_severity: 0,
      hazmat_count: 0,
      estimated_prevented: 0,
    };

    const res: StatsResponse = {
      total: Number(row.total),
      high_severity_count: Number(row.high_severity_count),
      average_severity: Math.round(Number(row.average_severity) * 10) / 10,
      hazmat_count: Number(row.hazmat_count),
      estimated_prevented: Number(row.estimated_prevented),
    };

    return NextResponse.json(res);
  } catch (error: unknown) {
    console.error("[API stats GET error]:", error);
    return NextResponse.json(
      { error: "INTERNAL_ERROR", message: "Failed to compute stats" },
      { status: 500 }
    );
  }
}
