import { describe, it, expect } from "vitest";
import { mapGrievanceCategory } from "./profile_grievances";
import { samplePointInPolygon, pickWeightedIndex, createPseudoRandom } from "./generator_utils";
import { computeParetoWeights, deriveWardExternalId, verifyRecordsWardMapping } from "./generate_synthetic_10k";
import * as turf from "@turf/turf";
import type { Feature, Polygon, MultiPolygon } from "geojson";

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

  it("samples points strictly inside a MultiPolygon honoring all parts and holes", () => {
    // Fake MultiPolygon with two disjoint parts and a hole in part 1:
    // Part 1: [0, 0] to [10, 10] with an inner hole [3, 3] to [7, 7]
    // Part 2: Disjoint square [20, 20] to [30, 30] (no hole)
    const fakeMulti: Feature<MultiPolygon> = turf.multiPolygon([
      [
        [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]],
        [[3, 3], [7, 3], [7, 7], [3, 7], [3, 3]],
      ],
      [
        [[20, 20], [30, 20], [30, 30], [20, 30], [20, 20]],
      ],
    ]);

    const holePoly = turf.polygon([[[3, 3], [7, 3], [7, 7], [3, 7], [3, 3]]]);
    const rng = createPseudoRandom(42);

    for (let i = 0; i < 50; i++) {
      const ptCoords = samplePointInPolygon(fakeMulti, rng);
      expect(ptCoords).not.toBeNull();
      const pt = turf.point(ptCoords!);

      // Point must be inside the MultiPolygon
      const insideMulti = turf.booleanPointInPolygon(pt, fakeMulti);
      expect(insideMulti).toBe(true);

      // Point must NEVER be inside the hole
      const insideHole = turf.booleanPointInPolygon(pt, holePoly);
      expect(insideHole).toBe(false);
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

describe("Generator Ward Mapping and Collision Unit Tests", () => {
  const fakeFeatureGK1 = {
    type: "Feature" as const,
    geometry: { type: "Polygon" as const, coordinates: [] },
    properties: {
      ward_id: "192",
      ward_name: "GREATER KAILASH-I",
    },
  };

  const fakeFeatureW192 = {
    type: "Feature" as const,
    geometry: { type: "Polygon" as const, coordinates: [] },
    properties: {
      ward_id: "192",
      ward_name: "Ward 192",
    },
  };

  it("derives distinct externalIds for two features sharing the same ward_id", () => {
    const extId1 = deriveWardExternalId(fakeFeatureGK1);
    const extId2 = deriveWardExternalId(fakeFeatureW192);

    expect(extId1).toBe("192-GREATER-KAILASH-I");
    expect(extId2).toBe("192-WARD-192");
    expect(extId1).not.toBe(extId2);
  });

  it("maps distinct DB ids correctly without collision", () => {
    const wardDbMap = new Map<string, string>([
      ["192-GREATER-KAILASH-I", "db-uuid-gk1"],
      ["192-WARD-192", "db-uuid-w192"],
    ]);

    const id1 = wardDbMap.get(deriveWardExternalId(fakeFeatureGK1));
    const id2 = wardDbMap.get(deriveWardExternalId(fakeFeatureW192));

    expect(id1).toBe("db-uuid-gk1");
    expect(id2).toBe("db-uuid-w192");
  });

  it("pre-insert guard passes when all rows match their sampled feature externalId", () => {
    const wardIdToExternalId = new Map<string, string>([
      ["db-uuid-gk1", "192-GREATER-KAILASH-I"],
      ["db-uuid-w192", "192-WARD-192"],
    ]);

    const records = [
      { id: "SYN-00000001", wardId: "db-uuid-gk1" },
      { id: "SYN-00000002", wardId: "db-uuid-w192" },
    ];
    const expected = ["192-GREATER-KAILASH-I", "192-WARD-192"];

    const checked = verifyRecordsWardMapping(records, expected, wardIdToExternalId);
    expect(checked).toBe(2);
  });

  it("pre-insert guard aborts with clear error when a row is mapped to wrong ward", () => {
    const wardIdToExternalId = new Map<string, string>([
      ["db-uuid-gk1", "192-GREATER-KAILASH-I"],
      ["db-uuid-w192", "192-WARD-192"],
    ]);

    // Simulate collision bug: point sampled from GK-1 but assigned db-uuid-w192
    const badRecords = [
      { id: "SYN-00000001", wardId: "db-uuid-w192" },
    ];
    const expected = ["192-GREATER-KAILASH-I"];

    expect(() => {
      verifyRecordsWardMapping(badRecords, expected, wardIdToExternalId);
    }).toThrow(/Ward mismatch for row SYN-00000001/);
  });
});
