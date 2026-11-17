import "server-only";
import { prisma } from "@/lib/db/prisma";
import { Prisma } from "@prisma/client";
import type { WardBucket, HotspotRanking } from "./trends";
import { rankHotspots } from "./trends";
import * as turf from "@turf/turf";
import landmarks from "../../../data/delhi_landmarks.json";

export interface SqlBucketRow {
  ward_name: string;
  hazard_category: string;
  count_w0: number;
  count_w1: number;
  count_w2: number;
  count_w3: number;
  avg_severity_w0: number;
  max_severity_w0: number;
}

export interface CitywideWeekData {
  week: "W-3" | "W-2" | "W-1" | "W0";
  total: number;
  counts: Record<string, number>;
}

export interface EarlyWarningResponse {
  hotspots: HotspotRanking[];
  citywide: CitywideWeekData[];
  wardCounts: Record<string, number>;
}

/**
 * Pure function to convert SQL bucket rows into WardBucket structures.
 * Groups by ward_name (which resolves from COALESCE(w.name, r.rawLocation)).
 * Reports in the same ward with different rawLocation land in the same bucket.
 */
export function convertSqlBucketsToWardBuckets(
  rows: SqlBucketRow[]
): Record<string, WardBucket> {
  const buckets: Record<string, WardBucket> = {};

  for (const row of rows) {
    const ward = row.ward_name;
    if (!buckets[ward]) {
      buckets[ward] = {
        ward,
        counts: [0, 0, 0, 0],
        categoryCounts: {},
      };
    }

    const b = buckets[ward]!;
    b.counts[0] += Number(row.count_w0);
    b.counts[1] += Number(row.count_w1);
    b.counts[2] += Number(row.count_w2);
    b.counts[3] += Number(row.count_w3);

    if (row.count_w0 > 0) {
      b.categoryCounts[row.hazard_category] =
        (b.categoryCounts[row.hazard_category] || 0) + Number(row.count_w0);
    }
  }

  return buckets;
}

/**
 * Pure function to compute citywide weekly category totals from SQL bucket rows.
 * Ordered chronologically: [W-3, W-2, W-1, W0].
 */
export function computeCitywideTrendFromBuckets(
  rows: SqlBucketRow[]
): CitywideWeekData[] {
  const weeks: CitywideWeekData[] = [
    { week: "W-3", total: 0, counts: {} },
    { week: "W-2", total: 0, counts: {} },
    { week: "W-1", total: 0, counts: {} },
    { week: "W0", total: 0, counts: {} },
  ];

  for (const row of rows) {
    const cat = row.hazard_category;
    const w3 = Number(row.count_w3);
    const w2 = Number(row.count_w2);
    const w1 = Number(row.count_w1);
    const w0 = Number(row.count_w0);

    if (w3 > 0) {
      weeks[0]!.counts[cat] = (weeks[0]!.counts[cat] || 0) + w3;
      weeks[0]!.total += w3;
    }
    if (w2 > 0) {
      weeks[1]!.counts[cat] = (weeks[1]!.counts[cat] || 0) + w2;
      weeks[1]!.total += w2;
    }
    if (w1 > 0) {
      weeks[2]!.counts[cat] = (weeks[2]!.counts[cat] || 0) + w1;
      weeks[2]!.total += w1;
    }
    if (w0 > 0) {
      weeks[3]!.counts[cat] = (weeks[3]!.counts[cat] || 0) + w0;
      weeks[3]!.total += w0;
    }
  }

  return weeks;
}

/**
 * Executes SQL aggregation over the 28-day window grouped by ward and category.
 * Grouping is strictly COALESCE(w."name", r."rawLocation"), r."hazardCategory".
 */
export async function getEarlyWarningSqlBuckets(now: Date = new Date()): Promise<SqlBucketRow[]> {
  const windowEnd = now;
  const w0Start = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const w1Start = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);
  const w2Start = new Date(now.getTime() - 21 * 24 * 60 * 60 * 1000);
  const w3Start = new Date(now.getTime() - 28 * 24 * 60 * 60 * 1000);

  const rawRows = await prisma.$queryRaw<SqlBucketRow[]>(Prisma.sql`
    SELECT
      COALESCE(w."name", r."rawLocation") AS ward_name,
      r."hazardCategory" AS hazard_category,
      COUNT(CASE WHEN r."createdAt" >= ${w0Start} AND r."createdAt" < ${windowEnd} THEN 1 END)::int AS count_w0,
      COUNT(CASE WHEN r."createdAt" >= ${w1Start} AND r."createdAt" < ${w0Start} THEN 1 END)::int AS count_w1,
      COUNT(CASE WHEN r."createdAt" >= ${w2Start} AND r."createdAt" < ${w1Start} THEN 1 END)::int AS count_w2,
      COUNT(CASE WHEN r."createdAt" >= ${w3Start} AND r."createdAt" < ${w2Start} THEN 1 END)::int AS count_w3,
      COALESCE(AVG(CASE WHEN r."createdAt" >= ${w0Start} AND r."createdAt" < ${windowEnd} THEN r."severityLevel" END), 0)::float8 AS avg_severity_w0,
      COALESCE(MAX(CASE WHEN r."createdAt" >= ${w0Start} AND r."createdAt" < ${windowEnd} THEN r."severityLevel" END), 0)::int AS max_severity_w0
    FROM "Report" r
    LEFT JOIN "Ward" w ON r."wardId" = w."id"
    WHERE r."createdAt" >= ${w3Start} AND r."createdAt" < ${windowEnd}
    GROUP BY COALESCE(w."name", r."rawLocation"), r."hazardCategory"
    ORDER BY ward_name ASC, r."hazardCategory" ASC
  `);

  return rawRows;
}

/**
 * For top-ranked hotspots, fetches ONLY the latest 3 W0 reports with coordinates
 * per ward (bounded query, max 3 rows per ward) to identify the nearest landmark.
 */
export async function attachLandmarksToHotspots(
  hotspots: HotspotRanking[],
  now: Date
): Promise<HotspotRanking[]> {
  const w0Start = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const windowEnd = now;

  const enriched: HotspotRanking[] = [];

  for (const h of hotspots) {
    const wardName = h.ward;

    // Bounded query: max 3 recent reports with coordinates in W0 for this ward
    const sampleReports = await prisma.report.findMany({
      where: {
        createdAt: { gte: w0Start, lt: windowEnd },
        OR: [
          { ward: { name: wardName } },
          { rawLocation: wardName },
        ],
        lat: { not: null },
        lng: { not: null },
      },
      take: 3,
      orderBy: { createdAt: "desc" },
      select: { lat: true, lng: true },
    });

    let area_landmark: string | undefined = undefined;

    if (sampleReports.length > 0) {
      const points = sampleReports
        .filter((r) => r.lat !== null && r.lng !== null)
        .map((r) => turf.point([r.lng!, r.lat!]));

      if (points.length > 0) {
        const fc = turf.featureCollection(points);
        const center = turf.center(fc);

        let nearest: string | null = null;
        let minDist = Infinity;
        for (const lm of landmarks) {
          const lmPt = turf.point([lm.lng, lm.lat]);
          const dist = turf.distance(center, lmPt, { units: "kilometers" });
          if (dist <= 3 && dist < minDist) {
            minDist = dist;
            nearest = lm.name;
          }
        }
        if (nearest) {
          area_landmark = nearest;
        }
      }
    }

    enriched.push({
      ...h,
      area_landmark,
    });
  }

  return enriched;
}

/**
 * End-to-end server function to compute Early Warning data using SQL buckets
 * and a shared "now" reference across all windows.
 */
export async function getEarlyWarningData(now: Date = new Date()): Promise<EarlyWarningResponse> {
  const sqlRows = await getEarlyWarningSqlBuckets(now);
  const buckets = convertSqlBucketsToWardBuckets(sqlRows);
  const citywide = computeCitywideTrendFromBuckets(sqlRows);

  // Compute this-week counts per ward for map hotspot shading
  const wardCounts: Record<string, number> = {};
  for (const [ward, b] of Object.entries(buckets)) {
    wardCounts[ward] = b.counts[0];
  }

  // Rank hotspots from bucket rows
  const ranked = rankHotspots(buckets, now.getTime(), 5);

  // Attach landmark via bounded query (only top hotspots, max 3 reports per ward)
  const hotspots = await attachLandmarksToHotspots(ranked, now);

  return {
    hotspots,
    citywide,
    wardCounts,
  };
}
