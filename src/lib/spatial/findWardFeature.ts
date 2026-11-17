import type { Feature } from "geojson";

export interface WardLookupInput {
  status: string;
  ward_id?: string | null;
  ward_name?: string | null;
}

/**
 * Pure function that finds the matching GeoJSON feature for a report's ward tag.
 * Checks feature.properties.ward_id against ward.ward_id.
 * Returns null if ward.status is not "matched" or no feature matches.
 */
export function findWardFeature(
  features: Feature[],
  ward?: WardLookupInput | null
): Feature | null {
  if (!ward || ward.status !== "matched" || !ward.ward_id) {
    return null;
  }

  const targetId = String(ward.ward_id).trim();

  const match = features.find((f) => {
    const featureWardId = f.properties?.ward_id;
    if (featureWardId === undefined || featureWardId === null) return false;
    return String(featureWardId).trim() === targetId;
  });

  return match || null;
}
