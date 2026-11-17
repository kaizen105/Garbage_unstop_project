import { describe, it, expect } from "vitest";
import { mapGrievanceCategory } from "./profile_grievances";
import { samplePointInPolygon, pickWeightedIndex, createPseudoRandom } from "./generator_utils";
import { computeParetoWeights } from "./generate_synthetic_10k";
import * as turf from "@turf/turf";
import type { Feature, Polygon } from "geojson";

describe("Profiler Category Mapping Unit Tests", () => {
  it("maps Electrical to electrical_hazard", () => {
    const res = mapGrievanceCategory("Electrical", "Street Light Not Working");
    expect(res.category).toBe("electrical_hazard");
    expect(res.excludedReason).toBeUndefined();
  });

  it("maps Solid Waste (Garbage) Related with standard subcategory to general_overflow", () => {
    const res = mapGrievanceCategory("Solid Waste (Garbage) Related", "Garbage dump");
    expect(res.category).toBe("general_overflow");
  });

  it("maps Solid Waste (Garbage) Related with Dead animal subcategory to biohazard_medical", () => {
    const res = mapGrievanceCategory("Solid Waste (Garbage) Related", "Dead animal(s)");
    expect(res.category).toBe("biohazard_medical");
  });

  it("excludes unmapped categories and records excludedReason", () => {
    const res = mapGrievanceCategory("Road Maintenance(Engg)", "Pothole repair");
    expect(res.category).toBeNull();
    expect(res.excludedReason).toBe("Road Maintenance(Engg)");
  });
});

describe("Generator Weighted Picker and Sampler Unit Tests", () => {
  it("picks weighted index predictably according to cumulative distribution", () => {
    const weights = [10, 30, 60]; // 10%, 30%, 60%
    expect(pickWeightedIndex(weights, 0.05)).toBe(0); // in first 10%
    expect(pickWeightedIndex(weights, 0.25)).toBe(1); // in next 30% (10% to 40%)
    expect(pickWeightedIndex(weights, 0.75)).toBe(2); // in last 60% (40% to 100%)
  });

  it("samples points strictly inside a polygon boundary", () => {
    // Fake polygon: a square between [10, 20] and [12, 22]
    const square: Feature<Polygon> = turf.polygon([[
      [10, 20],
      [12, 20],
      [12, 22],
      [10, 22],
      [10, 20],
    ]]);

    const rng = createPseudoRandom(42);
    for (let i = 0; i < 25; i++) {
      const ptCoords = samplePointInPolygon(square, rng);
      expect(ptCoords).not.toBeNull();
      const pt = turf.point(ptCoords!);
      const inside = turf.booleanPointInPolygon(pt, square);
      expect(inside).toBe(true);
    }
  });
});

describe("Generator Pareto Weighting Unit Tests", () => {
  it("allocates approximately 60 percent share to top 25 wards across 290 wards", () => {
    const weights = computeParetoWeights(290, 25, 0.60);
    expect(weights.length).toBe(290);
    const top25Sum = weights.slice(0, 25).reduce((a, b) => a + b, 0);
    const totalSum = weights.reduce((a, b) => a + b, 0);
    const topShare = top25Sum / totalSum;
    expect(topShare).toBeCloseTo(0.60, 4);
  });
});
