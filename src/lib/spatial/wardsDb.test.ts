import { describe, it, expect } from "vitest";
import { validateDelhiCoordinates, DELHI_BOUNDS } from "./wardsDb";

describe("validateDelhiCoordinates (pure validation)", () => {
  it("accepts valid coordinates inside Delhi bounds", () => {
    // Connaught Place: 28.6315, 77.2167
    const res = validateDelhiCoordinates(28.6315, 77.2167);
    expect(res).toEqual({ valid: true, lat: 28.6315, lng: 77.2167 });
  });

  it("rejects non-numeric or non-finite inputs", () => {
    expect(validateDelhiCoordinates(NaN, 77.2167)).toEqual({ valid: false });
    expect(validateDelhiCoordinates(28.6315, Infinity)).toEqual({ valid: false });
    expect(validateDelhiCoordinates("28.6315" as unknown as number, 77.2167)).toEqual({ valid: false });
    expect(validateDelhiCoordinates(null as unknown as number, 77.2167)).toEqual({ valid: false });
  });

  it("rejects coordinates outside Delhi bounding box", () => {
    // Arabian sea
    expect(validateDelhiCoordinates(18.0, 70.0)).toEqual({ valid: false });
    // Lat / Lng swapped: lat 77.2167, lng 28.6315
    expect(validateDelhiCoordinates(77.2167, 28.6315)).toEqual({ valid: false });
  });

  it("strictly enforces bounds limits", () => {
    expect(validateDelhiCoordinates(DELHI_BOUNDS.minLat - 0.01, 77.0)).toEqual({ valid: false });
    expect(validateDelhiCoordinates(DELHI_BOUNDS.maxLat + 0.01, 77.0)).toEqual({ valid: false });
    expect(validateDelhiCoordinates(28.5, DELHI_BOUNDS.minLon - 0.01)).toEqual({ valid: false });
    expect(validateDelhiCoordinates(28.5, DELHI_BOUNDS.maxLon + 0.01)).toEqual({ valid: false });
  });
});
