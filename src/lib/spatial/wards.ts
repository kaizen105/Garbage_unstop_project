import wardsData from "../../data/delhi_wards.json";
import * as turf from "@turf/turf";
import type { Feature, Polygon, MultiPolygon } from "geojson";

const isDemo = (wardsData as { demo_boundaries?: boolean }).demo_boundaries === true;

export type WardTag = 
  | { status: "matched"; ward_id: string; ward_name: string }
  | { status: "unmapped" }
  | { status: "invalid_coordinates" };

export function isDemoBoundaries(): boolean {
  return isDemo;
}

export function tagWard(coords: { lat: number; lng: number } | null): WardTag {
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
        return {
          status: "matched",
          ward_id: feature.properties.ward_id,
          ward_name: feature.properties.ward_name
        };
      }
    }
  } catch (error) {
    console.error("tagWard error:", error);
  }

  return { status: "unmapped" };
}
