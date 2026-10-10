import landmarks from "../../../data/delhi_landmarks.json";

export interface LocateResult {
  lat: number;
  lng: number;
  source: "gps" | "gazetteer";
  verify: boolean;
}

export function resolveCoordinates({ lat, lng, rawLocation }: { lat?: number, lng?: number, rawLocation: string }): LocateResult | null {
  // 1. Valid GPS
  if (lat !== undefined && lng !== undefined && !isNaN(lat) && !isNaN(lng)) {
    if (lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180) {
      return { lat, lng, source: "gps", verify: false };
    }
  }

  // 2. Gazetteer match
  if (rawLocation && rawLocation.trim().length > 0) {
    const text = rawLocation.toLowerCase();
    for (const lm of landmarks) {
      if (text.includes(lm.name.toLowerCase())) {
        return { lat: lm.lat, lng: lm.lng, source: "gazetteer", verify: lm.verify };
      }
    }
  }

  return null;
}
