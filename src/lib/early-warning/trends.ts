import { Report } from "@/lib/store/reports";

const ONE_DAY = 24 * 60 * 60 * 1000;
const ONE_WEEK = 7 * ONE_DAY;

export interface WardBucket {
  ward: string;
  counts: [number, number, number, number]; // [W0, W1, W2, W3] where W0 is most recent
  categoryCounts: Record<string, number>;
  latestReports?: Report[];
}

export interface HotspotRanking {
  ward: string;
  risk: "high" | "medium" | "low";
  this_week: number;
  pct_change: number;
  anomaly_score: number;
  score: number;
  sparkline: [number, number, number, number]; // [W-3, W-2, W-1, W0]
  dominant_category: string;
  likely_cause: string;
  suggested_department: string;
  projection: number;
  area_landmark?: string;
  mean?: number;
  std?: number;
  flagged_reason?: string;
}

import landmarks from "../../../data/delhi_landmarks.json";
import * as turf from "@turf/turf";

export function weeklyBuckets(reports: Report[], now: number = Date.now()): Record<string, WardBucket> {
  const buckets: Record<string, WardBucket> = {};

  for (const r of reports) {
    const ward =
      r.ward?.status === "matched" && r.ward.ward_name
        ? r.ward.ward_name
        : r.ward?.status === "unmapped"
        ? "Unresolved (no ward match)"
        : r.raw_location || "Unresolved (no ward match)";

    const ageMs = now - new Date(r.createdAt || Date.now()).getTime();
    if (ageMs < 0 || ageMs > 4 * ONE_WEEK) continue; // Skip future or >4 weeks old

    const weekIndex = Math.floor(ageMs / ONE_WEEK);
    if (weekIndex >= 4) continue;

    if (!buckets[ward]) {
      buckets[ward] = { ward, counts: [0, 0, 0, 0], categoryCounts: {}, latestReports: [] };
    }

    buckets[ward]!.counts[weekIndex as 0 | 1 | 2 | 3]++;
    if (weekIndex === 0) {
      buckets[ward]!.categoryCounts[r.hazard_category] = (buckets[ward]!.categoryCounts[r.hazard_category] || 0) + 1;
      buckets[ward]!.latestReports!.push(r);
    }
  }

  return buckets;
}

export function scoreWard(buckets: WardBucket | [number, number, number, number]) {
  const counts: [number, number, number, number] = Array.isArray(buckets) ? buckets : buckets.counts;
  const [this_week, w1, w2, w3] = counts;
  const prev_week = w1;
  const pct_change = prev_week === 0 ? (this_week > 0 ? 100 : 0) : ((this_week - prev_week) / prev_week) * 100;
  
  const prior_weeks = [w1, w2, w3];
  const mean = prior_weeks.reduce((a, b) => a + b, 0) / 3;
  // Sample variance with N - 1 = 2 degrees of freedom
  const variance = prior_weeks.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / 2;
  const sample_std = Math.sqrt(variance);
  const std_floor = Math.max(1, Math.sqrt(mean));
  const std = Math.max(std_floor, sample_std);
  
  const anomaly_score = (this_week - mean) / std;
  
  return { this_week, prev_week, pct_change, mean, std: sample_std, effective_std: std, anomaly_score };
}

export function projectNextWeek(input: [number, number, number, number] | { counts: [number, number, number, number] }) {
  const counts: [number, number, number, number] = Array.isArray(input) ? input : input.counts;
  // xs: [0, 1, 2, 3] for [W-3, W-2, W-1, W0]
  const xs: [number, number, number, number] = [0, 1, 2, 3];
  const ys = [counts[3], counts[2], counts[1], counts[0]]; // reverse so 0 is oldest, 3 is newest

  const n = 4;
  let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;
  for (let i = 0; i < n; i++) {
    const idx = i as 0 | 1 | 2 | 3;
    sumX += xs[idx] || 0;
    sumY += ys[idx] || 0;
    sumXY += (xs[idx] || 0) * (ys[idx] || 0);
    sumX2 += (xs[idx] || 0) * (xs[idx] || 0);
  }

  const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
  const last = ys[3] || 0;
  return Math.max(0, Math.round(last + slope));
}

export const MIN_HIGH_THRESHOLD = 13;

export function getRisk(
  anomaly_score: number,
  pct_change: number,
  this_week: number,
  mean: number = 0,
  prev_week: number = 0,
  minHigh: number = MIN_HIGH_THRESHOLD
): "high" | "medium" | "low" {
  // R2: "high" requires anomaly_score >= 2 AND this_week >= MIN_HIGH AND (this_week - mean) >= 3
  if (anomaly_score >= 2 && this_week >= minHigh && (this_week - mean) >= 3) {
    return "high";
  }
  // "medium" if anomaly_score >= 1 or pct rule when prev_week >= 3
  if (anomaly_score >= 1 || (pct_change >= 50 && this_week >= 2 && prev_week >= 3)) {
    return "medium";
  }
  return "low";
}

export function getWhyFlagged(
  risk: "high" | "medium" | "low",
  anomaly_score: number,
  this_week: number,
  minHigh: number = MIN_HIGH_THRESHOLD,
  pct_change: number = 0,
  prev_week: number = 0
): string {
  if (risk === "high") {
    return `score ${anomaly_score.toFixed(1)} is at least 2, and ${this_week} reports is at least ${minHigh}`;
  }
  if (risk === "medium") {
    if (anomaly_score >= 1) {
      return `score ${anomaly_score.toFixed(1)} is at least 1`;
    }
    return `increase +${pct_change.toFixed(0)}% with ${prev_week} baseline reports`;
  }
  return "within baseline variation";
}

export function getCategoryDetails(category: string) {
  switch (category) {
    case "construction_debris":
      return { cause: "unauthorized construction/demolition", dept: "Municipal Zoning Inspectors" };
    case "biohazard_medical":
      return { cause: "illegal medical waste dumping", dept: "Biomedical Waste / Health Department" };
    case "electrical_hazard":
      return { cause: "illegal cable stripping or demolition", dept: "Electrical Safety inspectors" };
    case "chemical":
      return { cause: "industrial discharge", dept: "Pollution Control inspectors" };
    default:
      return { cause: "general sanitation issue", dept: "Sanitation Department" };
  }
}

export function rankHotspots(
  input: Report[] | Record<string, WardBucket> | WardBucket[],
  now: number = Date.now(),
  n: number = 5
): HotspotRanking[] {
  if (!input) return [];

  let buckets: Record<string, WardBucket>;
  if (Array.isArray(input)) {
    if (input.length === 0) return [];
    const first = input[0];
    if (first && "counts" in first && "ward" in first) {
      buckets = {};
      for (const b of input as WardBucket[]) {
        buckets[b.ward] = b;
      }
    } else {
      buckets = weeklyBuckets(input as Report[], now);
    }
  } else {
    buckets = input;
  }

  const rankings: HotspotRanking[] = [];

  for (const b of Object.values(buckets) as WardBucket[]) {
    const ward = b.ward;
    if (ward === "Unresolved (no ward match)") continue;
    const score = scoreWard(b);
    
    // Wards with this_week >= 2
    if (score.this_week < 2) continue;

    let domCat = "unknown";
    let maxCatCount = 0;
    for (const cat in b.categoryCounts) {
      if (b.categoryCounts[cat]! > maxCatCount) {
        maxCatCount = b.categoryCounts[cat]!;
        domCat = cat;
      }
    }

    const details = getCategoryDetails(domCat);

    // Compute nearest landmark
    let area_landmark = undefined;
    const latest = b.latestReports;
    if (latest && latest.length > 0) {
      // Find valid points
      const points = latest
        .filter(r => r.coordinates && !isNaN(r.coordinates.lat) && !isNaN(r.coordinates.lng))
        .map(r => turf.point([r.coordinates!.lng, r.coordinates!.lat]));
        
      if (points.length > 0) {
        const fc = turf.featureCollection(points);
        const center = turf.center(fc);
        
        let nearest = null;
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

    const risk = getRisk(
      score.anomaly_score,
      score.pct_change,
      score.this_week,
      score.mean,
      score.prev_week,
      MIN_HIGH_THRESHOLD
    );
    const whyFlagged = getWhyFlagged(
      risk,
      score.anomaly_score,
      score.this_week,
      MIN_HIGH_THRESHOLD,
      score.pct_change,
      score.prev_week
    );

    rankings.push({
      ward,
      risk,
      this_week: score.this_week,
      pct_change: score.pct_change,
      anomaly_score: score.anomaly_score,
      score: score.anomaly_score,
      sparkline: [b.counts[3], b.counts[2], b.counts[1], b.counts[0]],
      dominant_category: domCat,
      likely_cause: details.cause,
      suggested_department: details.dept,
      projection: projectNextWeek(b.counts),
      area_landmark,
      mean: score.mean,
      std: score.std,
      flagged_reason: whyFlagged,
    });
  }

  // sort by anomaly_score then pct_change
  rankings.sort((a, b) => {
    if (Math.abs(b.anomaly_score - a.anomaly_score) > 0.01) {
      return b.anomaly_score - a.anomaly_score;
    }
    return b.pct_change - a.pct_change;
  });

  return rankings.slice(0, n);
}
