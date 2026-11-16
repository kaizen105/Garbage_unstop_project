import "server-only";
import { prisma } from "@/lib/db/prisma";
import { Prisma, HazardCategory } from "@prisma/client";
import { WeeklyAggregates, WardCategoryAggregate } from "./types";

interface AggregateRawRow {
  ward_key: string;
  ward_name: string;
  hazard_category: HazardCategory;
  current7: number;
  previous7: number;
  avg_severity: number;
  max_severity: number;
  count_hazmat: number;
  count_bypass: number;
  count_routine: number;
}

interface TotalsRawRow {
  current7: number;
  previous7: number;
  synthetic7: number;
  real7: number;
}

export async function getWeeklyAggregates(now: Date = new Date()): Promise<WeeklyAggregates> {
  const windowEnd = now;
  const windowStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const windowPrev = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);

  // Grouped aggregates query
  const rawRows = await prisma.$queryRaw<AggregateRawRow[]>(Prisma.sql`
    SELECT
      COALESCE(w."externalId", 'UNRESOLVED') AS ward_key,
      COALESCE(w."name", 'Unresolved Ward') AS ward_name,
      r."hazardCategory" AS hazard_category,
      COUNT(CASE WHEN r."createdAt" >= ${windowStart} AND r."createdAt" < ${windowEnd} THEN 1 END)::int AS current7,
      COUNT(CASE WHEN r."createdAt" >= ${windowPrev} AND r."createdAt" < ${windowStart} THEN 1 END)::int AS previous7,
      COALESCE(AVG(CASE WHEN r."createdAt" >= ${windowStart} AND r."createdAt" < ${windowEnd} THEN r."severityLevel" END), 0)::float8 AS avg_severity,
      COALESCE(MAX(CASE WHEN r."createdAt" >= ${windowStart} AND r."createdAt" < ${windowEnd} THEN r."severityLevel" END), 0)::int AS max_severity,
      COUNT(CASE WHEN r."createdAt" >= ${windowStart} AND r."createdAt" < ${windowEnd} AND r."actionRequired" = 'dispatch_hazmat_bypass_standard' THEN 1 END)::int AS count_hazmat,
      COUNT(CASE WHEN r."createdAt" >= ${windowStart} AND r."createdAt" < ${windowEnd} AND r."actionRequired" = 'bypass_standard' THEN 1 END)::int AS count_bypass,
      COUNT(CASE WHEN r."createdAt" >= ${windowStart} AND r."createdAt" < ${windowEnd} AND r."actionRequired" = 'routine_collection' THEN 1 END)::int AS count_routine
    FROM "Report" r
    LEFT JOIN "Ward" w ON r."wardId" = w."id"
    WHERE r."createdAt" >= ${windowPrev} AND r."createdAt" < ${windowEnd}
    GROUP BY COALESCE(w."externalId", 'UNRESOLVED'), COALESCE(w."name", 'Unresolved Ward'), r."hazardCategory"
    HAVING COUNT(CASE WHEN r."createdAt" >= ${windowStart} AND r."createdAt" < ${windowEnd} THEN 1 END) > 0
    ORDER BY current7 DESC, avg_severity DESC
  `);

  // Overall totals query for window
  const totalsRaw = await prisma.$queryRaw<TotalsRawRow[]>(Prisma.sql`
    SELECT
      COUNT(CASE WHEN "createdAt" >= ${windowStart} AND "createdAt" < ${windowEnd} THEN 1 END)::int AS current7,
      COUNT(CASE WHEN "createdAt" >= ${windowPrev} AND "createdAt" < ${windowStart} THEN 1 END)::int AS previous7,
      COUNT(CASE WHEN "createdAt" >= ${windowStart} AND "createdAt" < ${windowEnd} AND "isSynthetic" = true THEN 1 END)::int AS synthetic7,
      COUNT(CASE WHEN "createdAt" >= ${windowStart} AND "createdAt" < ${windowEnd} AND "isSynthetic" = false THEN 1 END)::int AS real7
    FROM "Report"
    WHERE "createdAt" >= ${windowPrev} AND "createdAt" < ${windowEnd}
  `);

  const totals = totalsRaw[0] ?? { current7: 0, previous7: 0, synthetic7: 0, real7: 0 };

  const rows: WardCategoryAggregate[] = rawRows.map((row) => ({
    wardKey: row.ward_key,
    wardName: row.ward_name,
    category: row.hazard_category,
    current7: Number(row.current7),
    previous7: Number(row.previous7),
    delta: Number(row.current7) - Number(row.previous7),
    avgSeverity: Math.round(Number(row.avg_severity) * 10) / 10,
    maxSeverity: Number(row.max_severity),
    actionCounts: {
      dispatch_hazmat_bypass_standard: Number(row.count_hazmat),
      bypass_standard: Number(row.count_bypass),
      routine_collection: Number(row.count_routine),
    },
  }));

  return {
    windowStart: windowStart.toISOString(),
    windowEnd: windowEnd.toISOString(),
    totals: {
      current7: Number(totals.current7),
      previous7: Number(totals.previous7),
      synthetic7: Number(totals.synthetic7),
      real7: Number(totals.real7),
    },
    rows,
  };
}
