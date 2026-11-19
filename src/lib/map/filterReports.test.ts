import { describe, it, expect } from "vitest";
import { filterReports } from "./filterReports";
import type { Report } from "@/lib/store/reports";

function makeMockReport(id: string, category: string, severity: number): Report {
  return {
    report_id: id,
    hazard_category: category,
    severity_level: severity,
    raw_location: "Test Location",
    action_required: "dispatch",
    coordinates: { lat: 28.6, lng: 77.2 },
    createdAt: new Date().toISOString(),
    ward: { status: "unmapped", ward_id: null, ward_name: null },
  };
}

describe("filterReports", () => {
  const sampleReports: Report[] = [
    makeMockReport("R1", "garbage_dump", 3),
    makeMockReport("R2", "biohazard_medical", 8),
    makeMockReport("R3", "garbage_dump", 7),
    makeMockReport("R4", "electrical_hazard", 5),
    makeMockReport("R5", "construction_debris", 2),
  ];

  it("returns all reports when default options are provided", () => {
    const res = filterReports(sampleReports);
    expect(res).toHaveLength(5);
  });

  it("returns all reports when category is 'all' and minSeverity is 0", () => {
    const res = filterReports(sampleReports, { category: "all", minSeverity: 0 });
    expect(res).toHaveLength(5);
  });

  it("filters by hazard category accurately", () => {
    const res = filterReports(sampleReports, { category: "garbage_dump" });
    expect(res).toHaveLength(2);
    expect(res.map((r) => r.report_id)).toEqual(["R1", "R3"]);
  });

  it("filters by minimum severity level", () => {
    const res = filterReports(sampleReports, { minSeverity: 7 });
    expect(res).toHaveLength(2);
    expect(res.map((r) => r.report_id)).toEqual(["R2", "R3"]);
  });

  it("filters by both category and minimum severity simultaneously", () => {
    const res = filterReports(sampleReports, { category: "garbage_dump", minSeverity: 5 });
    expect(res).toHaveLength(1);
    expect(res[0]?.report_id).toBe("R3");
  });

  it("returns empty array when no report matches criteria", () => {
    const res = filterReports(sampleReports, { category: "chemical", minSeverity: 1 });
    expect(res).toHaveLength(0);
  });

  it("handles empty input array gracefully", () => {
    const res = filterReports([], { category: "garbage_dump", minSeverity: 5 });
    expect(res).toEqual([]);
  });
});
