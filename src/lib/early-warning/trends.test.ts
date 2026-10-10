import { describe, it, expect } from "vitest";
import { 
  weeklyBuckets, 
  scoreWard, 
  projectNextWeek, 
  getRisk, 
  rankHotspots 
} from "./trends";
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
    expect(buckets["Connaught Place"]!.counts).toEqual([1, 1, 1, 1]);
    expect(buckets["Connaught Place"]!.categoryCounts["chemical"]).toBe(1); // only W0 counts for cat
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
});
