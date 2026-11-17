import { describe, it, expect } from "vitest";
import { 
  weeklyBuckets, 
  scoreWard, 
  projectNextWeek, 
  getRisk, 
  rankHotspots
} from "./trends";
import {
  convertSqlBucketsToWardBuckets,
  computeCitywideTrendFromBuckets,
  SqlBucketRow
} from "./sqlBuckets";
import { Report } from "@/lib/store/reports";

const ONE_DAY = 24 * 60 * 60 * 1000;

function makeReport(loc: string, cat: string, ageMs: number): Report {
  return {
    report_id: Math.random().toString(),
    transcript: "Test",
    hazard_category: cat,
    severity_level: 5,
    raw_location: loc,
    action_required: "routine_collection",
    createdAt: new Date(Date.now() - ageMs).toISOString(),
    coordinates: { lat: 0, lng: 0 }
  };
}

describe("Early Warning Trends", () => {
  it("weeklyBuckets correctly categorizes reports by window boundaries", () => {
    const now = Date.now();
    const reports = [
      makeReport("CP", "chemical", 1 * ONE_DAY), // W0
      makeReport("CP", "chemical", 8 * ONE_DAY), // W1
      makeReport("CP", "chemical", 15 * ONE_DAY), // W2
      makeReport("CP", "chemical", 22 * ONE_DAY), // W3
      makeReport("CP", "chemical", 30 * ONE_DAY), // W4 (ignored)
      makeReport("Lajpat Nagar", "biohazard_medical", -1 * ONE_DAY), // future (ignored)
    ];

    const buckets = weeklyBuckets(reports, now);
    expect(buckets["CP"]!.counts).toEqual([1, 1, 1, 1]);
    expect(buckets["CP"]!.categoryCounts["chemical"]).toBe(1); // only W0 counts for cat
    expect(buckets["Lajpat Nagar"]).toBeUndefined();
  });

  it("scoreWard handles divide-by-zero", () => {
    const res = scoreWard({ ward: "Test", counts: [5, 0, 0, 0], categoryCounts: {} });
    expect(res.pct_change).toBe(100);
    expect(res.mean).toBe(0);
    expect(res.std).toBe(0);
    expect(res.anomaly_score).toBe(5); // (5 - 0) / max(1, 0)
  });

  it("projectNextWeek works for rising, flat, falling clamped", () => {
    expect(projectNextWeek([0, 0, 0, 0])).toBe(0); // flat
    expect(projectNextWeek([4, 3, 2, 1])).toBe(5); // rising (W0=4, W1=3, W2=2, W3=1)
    expect(projectNextWeek([2, 3, 4, 5])).toBe(1); // falling (W0=2, W1=3, W2=4, W3=5)
    expect(projectNextWeek([0, 2, 5, 10])).toBe(0); // falling clamped to 0
  });

  it("getRisk assigns correct thresholds", () => {
    expect(getRisk(2.5, 0, 5)).toBe("high");
    expect(getRisk(0, 150, 4)).toBe("high");
    expect(getRisk(1.5, 0, 5)).toBe("medium");
    expect(getRisk(0, 60, 2)).toBe("medium");
    expect(getRisk(0, 0, 5)).toBe("low");
  });

  it("rankHotspots filters this_week < 2 and sorts properly", () => {
    const now = Date.now();
    const reports = [
      makeReport("Ward1", "chemical", 1 * ONE_DAY), // Only 1 this week
      makeReport("Ward2", "chemical", 1 * ONE_DAY),
      makeReport("Ward2", "chemical", 2 * ONE_DAY),
      // Ward2 has 2 this week, 0 prior. Anomaly = 2
      makeReport("Ward3", "biohazard_medical", 1 * ONE_DAY),
      makeReport("Ward3", "biohazard_medical", 2 * ONE_DAY),
      makeReport("Ward3", "biohazard_medical", 3 * ONE_DAY),
      // Ward3 has 3 this week, 0 prior. Anomaly = 3
    ];
    
    const hotspots = rankHotspots(reports, now);
    expect(hotspots.length).toBe(2);
    expect(hotspots[0]!.ward).toBe("Ward3"); // Higher anomaly
    expect(hotspots[1]!.ward).toBe("Ward2");
    
    expect(hotspots[0]!.dominant_category).toBe("biohazard_medical");
    expect(hotspots[0]!.risk).toBe("high");
  });

  it("rankHotspots handles empty/insufficient data gracefully", () => {
    expect(rankHotspots([])).toEqual([]);
    expect(rankHotspots([], Date.now())).toEqual([]);
  });

  it("proves two reports with different rawLocation in the same ward land in one bucket", () => {
    // In SQL: COALESCE(w.name, r.rawLocation) groups two reports from "Ajmal Khan Rd" and "Pusa Rd"
    // into the same resolved ward name "Karol Bagh"
    const sqlRows: SqlBucketRow[] = [
      {
        ward_name: "Karol Bagh", // Report 1 had rawLocation "Ajmal Khan Rd"
        hazard_category: "electrical_hazard",
        count_w0: 3,
        count_w1: 1,
        count_w2: 0,
        count_w3: 0,
        avg_severity_w0: 7.5,
        max_severity_w0: 9,
      },
      {
        ward_name: "Karol Bagh", // Report 2 had rawLocation "Pusa Rd"
        hazard_category: "general_overflow",
        count_w0: 2,
        count_w1: 2,
        count_w2: 1,
        count_w3: 1,
        avg_severity_w0: 5.0,
        max_severity_w0: 6,
      },
    ];

    const buckets = convertSqlBucketsToWardBuckets(sqlRows);

    // Assert both land in the single "Karol Bagh" bucket
    expect(Object.keys(buckets)).toEqual(["Karol Bagh"]);
    const kb = buckets["Karol Bagh"]!;
    expect(kb.ward).toBe("Karol Bagh");
    // W0 = 3 + 2 = 5, W1 = 1 + 2 = 3, W2 = 0 + 1 = 1, W3 = 0 + 1 = 1
    expect(kb.counts).toEqual([5, 3, 1, 1]);
    expect(kb.categoryCounts).toEqual({
      electrical_hazard: 3,
      general_overflow: 2,
    });
  });

  it("rankHotspots and projectNextWeek accept bucket rows with fixed numbers", () => {
    const bucketRows: SqlBucketRow[] = [
      {
        ward_name: "NDMC CHARGE 2",
        hazard_category: "chemical",
        count_w0: 8,
        count_w1: 2,
        count_w2: 1,
        count_w3: 0,
        avg_severity_w0: 8.0,
        max_severity_w0: 10,
      },
      {
        ward_name: "AMAR COLONY",
        hazard_category: "biohazard_medical",
        count_w0: 4,
        count_w1: 3,
        count_w2: 2,
        count_w3: 2,
        avg_severity_w0: 7.0,
        max_severity_w0: 8,
      },
      {
        ward_name: "QUIET WARD",
        hazard_category: "general_overflow",
        count_w0: 1, // < 2, should be filtered out
        count_w1: 0,
        count_w2: 0,
        count_w3: 0,
        avg_severity_w0: 3.0,
        max_severity_w0: 3,
      },
    ];

    const buckets = convertSqlBucketsToWardBuckets(bucketRows);
    const hotspots = rankHotspots(buckets);

    // Only wards with this_week >= 2 are ranked
    expect(hotspots.length).toBe(2);
    expect(hotspots[0]!.ward).toBe("NDMC CHARGE 2");
    expect(hotspots[0]!.this_week).toBe(8);
    expect(hotspots[0]!.dominant_category).toBe("chemical");
    expect(hotspots[0]!.risk).toBe("high");

    // projectNextWeek accepting bucket object with counts [8, 2, 1, 0]
    // ys = [0, 1, 2, 8], slope = 2.5 -> 8 + 2.5 = 10.5 -> Math.round = 11
    const proj1 = projectNextWeek(buckets["NDMC CHARGE 2"]!);
    expect(proj1).toBe(11);

    // projectNextWeek accepting array directly
    expect(projectNextWeek([4, 3, 2, 1])).toBe(5);
  });

  it("computeCitywideTrendFromBuckets aggregates 4-week totals chronologically", () => {
    const rows: SqlBucketRow[] = [
      {
        ward_name: "W1",
        hazard_category: "chemical",
        count_w0: 10,
        count_w1: 5,
        count_w2: 2,
        count_w3: 1,
        avg_severity_w0: 7,
        max_severity_w0: 9,
      },
      {
        ward_name: "W2",
        hazard_category: "electrical_hazard",
        count_w0: 8,
        count_w1: 4,
        count_w2: 3,
        count_w3: 2,
        avg_severity_w0: 6,
        max_severity_w0: 8,
      },
    ];

    const citywide = computeCitywideTrendFromBuckets(rows);
    expect(citywide.length).toBe(4);
    expect(citywide[0]!.week).toBe("W-3");
    expect(citywide[0]!.total).toBe(3); // 1 + 2
    expect(citywide[1]!.week).toBe("W-2");
    expect(citywide[1]!.total).toBe(5); // 2 + 3
    expect(citywide[2]!.week).toBe("W-1");
    expect(citywide[2]!.total).toBe(9); // 5 + 4
    expect(citywide[3]!.week).toBe("W0");
    expect(citywide[3]!.total).toBe(18); // 10 + 8
    expect(citywide[3]!.counts).toEqual({ chemical: 10, electrical_hazard: 8 });
  });
});
