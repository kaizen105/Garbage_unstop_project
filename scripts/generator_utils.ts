import * as turf from "@turf/turf";
import type { Feature, Polygon, MultiPolygon } from "geojson";

export function samplePointInPolygon(
  feature: Feature<Polygon | MultiPolygon>,
  randomFn: () => number = Math.random,
  maxAttempts: number = 200
): [number, number] | null {
  const geom = feature.geometry;
  if (!geom) return null;

  let parts: number[][][][];
  if (geom.type === "Polygon") {
    parts = [geom.coordinates];
  } else if (geom.type === "MultiPolygon") {
    parts = geom.coordinates;
  } else {
    return null;
  }

  if (parts.length === 0) return null;

  const partPolys = parts.map((coords) => turf.polygon(coords));
  const partAreas = partPolys.map((poly) => Math.max(turf.area(poly), 1e-6));
  const partBboxes = partPolys.map((poly) => turf.bbox(poly));

  for (let i = 0; i < maxAttempts; i++) {
    const partIdx = pickWeightedIndex(partAreas, randomFn());
    const bbox = partBboxes[partIdx]!;
    const [minX, minY, maxX, maxY] = bbox;

    const lng = minX + randomFn() * (maxX - minX);
    const lat = minY + randomFn() * (maxY - minY);
    const pt = turf.point([lng, lat]);

    // Test strictly against the full MultiPolygon / Polygon (all parts, honoring holes)
    if (turf.booleanPointInPolygon(pt, feature)) {
      return [lng, lat];
    }
  }

  // Guaranteed fallback: pointOnFeature verified against the feature
  const onFeature = turf.pointOnFeature(feature);
  if (turf.booleanPointInPolygon(onFeature, feature)) {
    return onFeature.geometry.coordinates as [number, number];
  }

  return null;
}

export function pickWeightedIndex(weights: number[], randomVal: number): number {
  const total = weights.reduce((a, b) => a + b, 0);
  let threshold = randomVal * total;

  for (let i = 0; i < weights.length; i++) {
    threshold -= weights[i] || 0;
    if (threshold <= 0) {
      return i;
    }
  }

  return weights.length - 1;
}

export function createPseudoRandom(seed: number): () => number {
  let s = seed % 2147483647;
  if (s <= 0) s += 2147483646;

  return function () {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}
