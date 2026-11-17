import { describe, it, expect } from "vitest";
import { findWardFeature } from "./findWardFeature";
import type { Feature } from "geojson";
import type { WardTag } from "@/lib/validation/schemas";

const mockFeatures: Feature[] = [
  {
    type: "Feature",
    geometry: { type: "Polygon", coordinates: [] },
    properties: {
      ward_id: "192",
      ward_name: "GREATER KAILASH-I",
    },
  },
  {
    type: "Feature",
    geometry: { type: "Polygon", coordinates: [] },
    properties: {
      ward_id: "042",
      ward_name: "ROHINI-C",
    },
  },
];

describe("findWardFeature Unit Tests", () => {
  it("returns matching feature when ward.status is matched and ward_id exists", () => {
    const matchedTag: WardTag = {
      status: "matched",
      ward_id: "192",
      ward_name: "GREATER KAILASH-I",
    };

    const res = findWardFeature(mockFeatures, matchedTag);
    expect(res).not.toBeNull();
    expect(res?.properties?.ward_name).toBe("GREATER KAILASH-I");
  });

  it("returns null when ward_id does not match any feature in collection", () => {
    const nonExistentTag: WardTag = {
      status: "matched",
      ward_id: "999",
      ward_name: "UNKNOWN-WARD",
    };

    const res = findWardFeature(mockFeatures, nonExistentTag);
    expect(res).toBeNull();
  });

  it("returns null when ward.status is not matched (e.g. unmapped)", () => {
    const unmappedTag: WardTag = {
      status: "unmapped",
      ward_id: null,
      ward_name: null,
    };

    const res = findWardFeature(mockFeatures, unmappedTag);
    expect(res).toBeNull();
  });

  it("returns null when ward is undefined or null", () => {
    expect(findWardFeature(mockFeatures, undefined)).toBeNull();
    expect(findWardFeature(mockFeatures, null)).toBeNull();
  });
});
