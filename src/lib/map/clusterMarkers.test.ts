import { describe, it, expect } from "vitest";
import { clusterReports } from "./clusterMarkers";
import type { Report } from "@/lib/store/reports";

function makeReport(id: string, lat: number, lng: number, category: string = "general_overflow", severity: number = 5): Report {
  return {
    report_id: id,
    hazard_category: category,
    severity_level: severity,
    raw_location: "Test Location",
    action_required: "routine_collection",
    coordinates: { lat, lng },
    createdAt: new Date().toISOString(),
    ward: { status: "unmapped", ward_id: null, ward_name: null },
  };
}

describe("clusterReports", () => {
  it("returns empty clusters and singles when report list is empty", () => {
    const res = clusterReports([]);
    expect(res.clusters).toHaveLength(0);
    expect(res.singles).toHaveLength(0);
  });

  it("leaves distant reports as single markers", () => {
    const r1 = makeReport("R1", 28.50, 77.10);
    const r2 = makeReport("R2", 28.70, 77.30);
    const res = clusterReports([r1, r2], 0.018);
    expect(res.clusters).toHaveLength(0);
    expect(res.singles).toHaveLength(2);
  });

  it("groups closely situated reports into a cluster", () => {
    const r1 = makeReport("R1", 28.6001, 77.2001, "biohazard_medical", 8);
    const r2 = makeReport("R2", 28.6002, 77.2003, "biohazard_medical", 6);
    const r3 = makeReport("R3", 28.6004, 77.2002, "general_overflow", 4);
    const distant = makeReport("R4", 28.7500, 77.3500, "electrical_hazard", 7);

    const res = clusterReports([r1, r2, r3, distant], 0.018);
    expect(res.clusters).toHaveLength(1);
    expect(res.clusters[0]?.count).toBe(3);
    expect(res.clusters[0]?.maxSeverity).toBe(8);
    expect(res.clusters[0]?.dominantCategory).toBe("biohazard_medical");
    expect(res.singles).toHaveLength(1);
    expect(res.singles[0]?.report_id).toBe("R4");
  });

  it("skips reports with missing, non-finite, or out-of-range coordinates", () => {
    const valid = makeReport("R1", 28.60, 77.20);
    const nullCoords: Report = {
      ...makeReport("R2", 0, 0),
      coordinates: null,
    };
    const nanCoords = makeReport("R3", NaN, 77.20);
    const infCoords = makeReport("R4", Infinity, 77.20);
    const negInfCoords = makeReport("R5", 28.60, -Infinity);
    const latTooHigh = makeReport("R6", 95.0, 77.20);
    const latTooLow = makeReport("R7", -95.0, 77.20);
    const lngTooHigh = makeReport("R8", 28.60, 185.0);
    const lngTooLow = makeReport("R9", 28.60, -185.0);

    const res = clusterReports([
      valid,
      nullCoords,
      nanCoords,
      infCoords,
      negInfCoords,
      latTooHigh,
      latTooLow,
      lngTooHigh,
      lngTooLow,
    ]);
    expect(res.singles).toHaveLength(1);
    expect(res.singles[0]?.report_id).toBe("R1");
    expect(res.clusters).toHaveLength(0);
  });

  it("handles grid-cell boundary partitioning correctly", () => {
    // gridSize = 0.018.
    // cell boundary is at half-intervals: e.g. 1583.5 * 0.018 = 28.503.
    // Point A at 28.5029 -> 28.5029 / 0.018 = 1583.494 -> Math.round is 1583.
    // Point B at 28.5031 -> 28.5031 / 0.018 = 1583.505 -> Math.round is 1584.
    // Even though they are ~22m apart, fixed-grid binning places them in adjacent cells.
    const rA = makeReport("RA", 28.5029, 77.2000);
    const rB = makeReport("RB", 28.5031, 77.2000);
    const resBoundary = clusterReports([rA, rB], 0.018);
    expect(resBoundary.clusters).toHaveLength(0);
    expect(resBoundary.singles).toHaveLength(2);

    // Points inside the same cell merge into a cluster
    const rC = makeReport("RC", 28.5025, 77.2000);
    const resMerged = clusterReports([rA, rC], 0.018);
    expect(resMerged.clusters).toHaveLength(1);
    expect(resMerged.clusters[0]?.count).toBe(2);
    expect(resMerged.singles).toHaveLength(0);
  });
});
