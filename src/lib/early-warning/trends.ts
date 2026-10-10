import { Report } from "@/lib/store/reports";

const ONE_DAY = 24 * 60 * 60 * 1000;
const ONE_WEEK = 7 * ONE_DAY;

export interface WardBucket {
  ward: string;
  counts: [number, number, number, number]; // [W0, W1, W2, W3] where W0 is most recent
  categoryCounts: Record<string, number>;
}

export interface HotspotRanking {
  ward: string;
  risk: "high" | "medium" | "low";
  this_week: number;
  pct_change: number;
  anomaly_score: number;
  sparkline: [number, number, number, number]; // [W-3, W-2, W-1, W0]
  dominant_category: string;
  likely_cause: string;
  suggested_department: string;
  projection: number;
}

export function weeklyBuckets(reports: Report[], now: number = Date.now()): Record<string, WardBucket> {
  const buckets: Record<string, WardBucket> = {};

  for (const r of reports) {
    // Basic ward matching based on location string. (Assuming seed data uses basic prefixes or we extract it)
    let ward = "Unknown";
    const loc = r.raw_location.toLowerCase();
    if (loc.includes("connaught place") || loc.includes("cp")) ward = "Connaught Place";
    else if (loc.includes("lajpat nagar")) ward = "Lajpat Nagar";
    else if (loc.includes("karol bagh")) ward = "Karol Bagh";
    else ward = r.raw_location; // Fallback

    const ageMs = now - new Date(r.createdAt || Date.now()).getTime();
    if (ageMs < 0 || ageMs > 4 * ONE_WEEK) continue; // Skip future or >4 weeks old

    const weekIndex = Math.floor(ageMs / ONE_WEEK);
    if (weekIndex >= 4) continue;

    if (!buckets[ward]) {
      buckets[ward] = { ward, counts: [0, 0, 0, 0], categoryCounts: {} };
    }

    buckets[ward]!.counts[weekIndex as 0 | 1 | 2 | 3]++;
    if (weekIndex === 0) {
      buckets[ward]!.categoryCounts[r.hazard_category] = (buckets[ward]!.categoryCounts[r.hazard_category] || 0) + 1;
    }
  }

  return buckets;
}

export function scoreWard(buckets: WardBucket) {
  const [this_week, w1, w2, w3] = buckets.counts;
  const prev_week = w1;
  const pct_change = prev_week === 0 ? (this_week > 0 ? 100 : 0) : ((this_week - prev_week) / prev_week) * 100;
  
  const prior_weeks = [w1, w2, w3];
  const mean = prior_weeks.reduce((a, b) => a + b, 0) / 3;
  const variance = prior_weeks.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / 3;
  const std = Math.sqrt(variance);
  
  const anomaly_score = (this_week - mean) / Math.max(1, std);
  
  return { this_week, prev_week, pct_change, mean, std, anomaly_score };
}

export function projectNextWeek(counts: [number, number, number, number]) {
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

export function getRisk(anomaly_score: number, pct_change: number, this_week: number): "high" | "medium" | "low" {
  // "high" if anomaly_score >= 2 or pct_change >= 100% with this_week >=3
  if (anomaly_score >= 2 || (pct_change >= 100 && this_week >= 3)) return "high";
  // "medium" if anomaly_score >= 1 or pct_change >= 50% with this_week >= 2
  if (anomaly_score >= 1 || (pct_change >= 50 && this_week >= 2)) return "medium";
  return "low";
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

export function rankHotspots(reports: Report[], now: number = Date.now(), n: number = 5): HotspotRanking[] {
  if (!reports || reports.length === 0) return [];

  const buckets = weeklyBuckets(reports, now);
  const rankings: HotspotRanking[] = [];

  for (const b of Object.values(buckets) as WardBucket[]) {
    const ward = b.ward;
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

    rankings.push({
      ward,
      risk: getRisk(score.anomaly_score, score.pct_change, score.this_week),
      this_week: score.this_week,
      pct_change: score.pct_change,
      anomaly_score: score.anomaly_score,
      sparkline: [b.counts[3], b.counts[2], b.counts[1], b.counts[0]],
      dominant_category: domCat,
      likely_cause: details.cause,
      suggested_department: details.dept,
      projection: projectNextWeek(b.counts)
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
