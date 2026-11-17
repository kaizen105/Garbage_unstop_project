import wardsData from "../../data/delhi_wards.json";
import * as turf from "@turf/turf";
import type { Feature, Polygon, MultiPolygon } from "geojson";

const isDemo = (wardsData as { demo_boundaries?: boolean }).demo_boundaries === true;

export function slugWardName(name: string): string {
  // Uppercase, non-alphanumerics -> "-", trimmed
  return name.toUpperCase().replace(/[^A-Z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

export function deriveWardExternalId(
  feature: Feature<Polygon | MultiPolygon> | { properties?: { ward_id?: unknown; ward_name?: unknown; WARD_NAME?: unknown } | null }
): string {
  const props = feature.properties;
  const wid = String(props?.ward_id ?? "").trim();
  const wname = String(props?.ward_name ?? props?.WARD_NAME ?? "").trim();
  const slugName = slugWardName(wname);
  return `${wid}-${slugName}`;
}

export type WardTag = 
  | { status: "matched"; ward_id: string; ward_name: string; external_id: string }
  | { status: "unmapped" }
  | { status: "invalid_coordinates" };

export function isDemoBoundaries(): boolean {
  return isDemo;
}

/**
 * Sync Turf-based ward tagging implementation.
 * IMPORTANT: test oracle / static seed only.
 * The production write path uses `tagWardDb` from `@/lib/spatial/wardsDb`.
 */
export function tagWardTurf(coords: { lat: number; lng: number } | null): WardTag {
  if (!coords) {
    return { status: "unmapped" };
  }

  if (isNaN(coords.lat) || isNaN(coords.lng) || coords.lat < -90 || coords.lat > 90 || coords.lng < -180 || coords.lng > 180) {
    return { status: "invalid_coordinates" };
  }

  try {
    const pt = turf.point([coords.lng, coords.lat]);
    for (const feature of (wardsData as { features: Feature<Polygon | MultiPolygon>[] }).features) {
      if (turf.booleanPointInPolygon(pt, feature)) {
        const wardId = String(feature.properties?.ward_id ?? "");
        const wardName = String(feature.properties?.ward_name ?? "");
        const externalId = `${wardId}-${slugWardName(wardName)}`;
        return {
          status: "matched",
          ward_id: wardId,
          ward_name: wardName,
          external_id: externalId,
        };
      }
    }
  } catch (error) {
    console.error("tagWardTurf error:", error);
  }

  return { status: "unmapped" };
}

// Backward-compatible alias for static modules & unit tests
export const tagWard = tagWardTurf;
