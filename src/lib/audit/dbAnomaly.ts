import "server-only";
import { prisma } from "@/lib/db/prisma";
import { Prisma } from "@prisma/client";
import type { AnomalyCluster } from "./audit";
import { getAsOf, computeWindowEnd } from "@/lib/asOf";

interface SqlAnomalyRow {
  ward_name: string;
  hazard_category: string;
  this_week: number;
  prev_week: number;
  increase: number;
  pct_ratio: number;
  avg_lat: number | null;
  avg_lng: number | null;
  geo_count: number;
}

/**
 * Bounded SQL aggregation to find the single largest weekly hazard anomaly in Postgres.
 * Groups by COALESCE(w."name", r."rawLocation") and r."hazardCategory".
 * Considers reports in the last 14 days without loading 10,000 rows into memory.
 */
export async function findLargestAnomalyFromDb(asOfInput?: Date): Promise<AnomalyCluster | null> {
  // live reports with isSynthetic = false and createdAt after asOf fall outside these windows by design.
  const asOf = asOfInput ?? (await getAsOf());
  const windowEnd = computeWindowEnd(asOf); // asOf plus 1 second
  const ONE_WEEK = 7 * 24 * 60 * 60 * 1000;
  const thisWeekStart = new Date(windowEnd.getTime() - ONE_WEEK);
  const prevWeekStart = new Date(windowEnd.getTime() - 2 * ONE_WEEK);

  const rows = await prisma.$queryRaw<SqlAnomalyRow[]>(Prisma.sql`
    WITH ward_category_counts AS (
      SELECT
        COALESCE(w."name", r."rawLocation") AS ward_name,
        r."hazardCategory" AS hazard_category,
        COUNT(CASE WHEN r."createdAt" >= ${thisWeekStart} AND r."createdAt" < ${windowEnd} THEN 1 END)::int AS this_week,
        COUNT(CASE WHEN r."createdAt" >= ${prevWeekStart} AND r."createdAt" < ${thisWeekStart} THEN 1 END)::int AS prev_week,
        AVG(CASE WHEN r."createdAt" >= ${thisWeekStart} AND r."createdAt" < ${windowEnd} AND r."lat" IS NOT NULL THEN r."lat" END)::float8 AS avg_lat,
        AVG(CASE WHEN r."createdAt" >= ${thisWeekStart} AND r."createdAt" < ${windowEnd} AND r."lng" IS NOT NULL THEN r."lng" END)::float8 AS avg_lng,
        COUNT(CASE WHEN r."createdAt" >= ${thisWeekStart} AND r."createdAt" < ${windowEnd} AND r."lat" IS NOT NULL AND r."lng" IS NOT NULL THEN 1 END)::int AS geo_count
      FROM "Report" r
      LEFT JOIN "Ward" w ON r."wardId" = w."id"
      WHERE r."createdAt" >= ${prevWeekStart} AND r."createdAt" < ${windowEnd}
      GROUP BY COALESCE(w."name", r."rawLocation"), r."hazardCategory"
      HAVING COUNT(CASE WHEN r."createdAt" >= ${thisWeekStart} AND r."createdAt" < ${windowEnd} THEN 1 END) >= 3
    )
    SELECT
      ward_name,
      hazard_category,
      this_week,
      prev_week,
      (this_week - prev_week) AS increase,
      CASE
        WHEN prev_week = 0 THEN 10.0
        ELSE (this_week - prev_week)::float8 / prev_week::float8
      END AS pct_ratio,
      avg_lat,
      avg_lng,
      geo_count
    FROM ward_category_counts
    ORDER BY increase DESC, this_week DESC
    LIMIT 1;
  `);

  if (!rows || rows.length === 0 || !rows[0]) {
    return null;
  }

  const row = rows[0];
  const pctRatio = Number(row.pct_ratio);
  const pctIncrease = Number(row.prev_week) === 0 ? 1000 : Math.round(pctRatio * 100);

  const centroid =
    row.geo_count > 0 && row.avg_lat !== null && row.avg_lng !== null
      ? { lat: Number(row.avg_lat), lng: Number(row.avg_lng) }
      : null;

  return {
    ward: row.ward_name,
    category: row.hazard_category,
    this_week: Number(row.this_week),
    prev_week: Number(row.prev_week),
    pct_increase: pctIncrease,
    centroid,
  };
}
