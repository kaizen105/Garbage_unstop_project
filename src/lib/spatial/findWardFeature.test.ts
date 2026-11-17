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
      ward_id: "192",
      ward_name: "Ward 192",
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
  it("distinguishes between duplicate ward_id 192 features using ward_name and external_id", () => {
    // 1. GREATER KAILASH-I
    const gkTag: WardTag = {
      status: "matched",
      ward_id: "192",
      ward_name: "GREATER KAILASH-I",
      external_id: "192-GREATER-KAILASH-I",
    };
    const gkRes = findWardFeature(mockFeatures, gkTag);
    expect(gkRes).not.toBeNull();
    expect(gkRes?.properties?.ward_name).toBe("GREATER KAILASH-I");

    // 2. Ward 192
    const w192Tag: WardTag = {
      status: "matched",
      ward_id: "192",
      ward_name: "Ward 192",
      external_id: "192-WARD-192",
    };
    const w192Res = findWardFeature(mockFeatures, w192Tag);
    expect(w192Res).not.toBeNull();
    expect(w192Res?.properties?.ward_name).toBe("Ward 192");
  });

  it("distinguishes between duplicate ward_id 192 features without external_id via slugged ward_name", () => {
    const w192TagNoExt: WardTag = {
      status: "matched",
      ward_id: "192",
      ward_name: "Ward 192",
    };
    const res = findWardFeature(mockFeatures, w192TagNoExt);
    expect(res).not.toBeNull();
    expect(res?.properties?.ward_name).toBe("Ward 192");
  });

  it("returns matching feature when ward.status is matched and ward_id exists", () => {
    const matchedTag: WardTag = {
      status: "matched",
      ward_id: "042",
      ward_name: "ROHINI-C",
    };

    const res = findWardFeature(mockFeatures, matchedTag);
    expect(res).not.toBeNull();
    expect(res?.properties?.ward_name).toBe("ROHINI-C");
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
