import * as turf from "@turf/turf";
import type { Feature, Polygon, MultiPolygon } from "geojson";

export function samplePointInPolygon(
  feature: Feature<Polygon | MultiPolygon>,
  randomFn: () => number = Math.random,
  maxAttempts: number = 200
): [number, number] | null {
  const bbox = turf.bbox(feature); // [minX, minY, maxX, maxY]
  const [minX, minY, maxX, maxY] = bbox;

  for (let i = 0; i < maxAttempts; i++) {
    const lng = minX + randomFn() * (maxX - minX);
    const lat = minY + randomFn() * (maxY - minY);
    const pt = turf.point([lng, lat]);

    if (turf.booleanPointInPolygon(pt, feature)) {
      return [lng, lat];
    }
  }

  // Fallback to polygon centroid if rejection sampling exhausts attempts
  const centroid = turf.centroid(feature);
  return centroid.geometry.coordinates as [number, number];
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
