import type { Feature } from "geojson";
import { slugWardName, deriveWardExternalId } from "./wards";

export interface WardLookupInput {
  status: string;
  ward_id?: string | null;
  ward_name?: string | null;
  external_id?: string | null;
}

/**
 * Pure function that finds the matching GeoJSON feature for a report's ward tag.
 * Checks external_id if available, or matches ward_id plus slugged ward name.
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
  const targetExternalId = ward.external_id ? String(ward.external_id).trim() : null;
  const targetSlug = ward.ward_name ? slugWardName(ward.ward_name) : null;

  const match = features.find((f) => {
    const featureWardId = f.properties?.ward_id;
    if (featureWardId === undefined || featureWardId === null) return false;
    if (String(featureWardId).trim() !== targetId) return false;

    if (targetExternalId) {
      const featExtId = deriveWardExternalId(f);
      return featExtId === targetExternalId;
    }

    if (targetSlug) {
      const featName = String(f.properties?.ward_name || f.properties?.WARD_NAME || "");
      return slugWardName(featName) === targetSlug;
    }

    return true;
  });

  return match || null;
}
