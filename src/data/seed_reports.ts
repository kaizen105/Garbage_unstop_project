import rawSeed from "../../data/seed_raw.json";
import { Report } from "../lib/store/reports";
import { z } from "zod";
import { getActionRequired } from "../app/api/report/route";
import { tagWard } from "../lib/spatial/wards";
import * as turf from "@turf/turf";

const ONE_DAY = 24 * 60 * 60 * 1000;
const now = Date.now();

const seedSchema = z.object({
  id: z.string(),
  hazard_category: z.string(),
  severity_level: z.number(),
  raw_location: z.string(),
  coordinates: z.object({
    lat: z.number(),
    lng: z.number()
  }),
  action_required: z.string(),
  transcript: z.string(),
  days_ago: z.number()
});

let dropped = 0;
let unmappedCount = 0;
const unmappedIds: string[] = [];

const anchors = [
  { name: "CP", lat: 28.6315, lng: 77.2167, targetWard: "" },
  { name: "KB", lat: 28.6448, lng: 77.1891, targetWard: "" },
  { name: "LN", lat: 28.5677, lng: 77.2433, targetWard: "" },
  { name: "LX", lat: 28.6304, lng: 77.2773, targetWard: "" },
  { name: "OK", lat: 28.5355, lng: 77.2750, targetWard: "" },
];

anchors.forEach(a => {
  const tag = tagWard(a);
  if (tag.status === "matched") {
    a.targetWard = tag.ward_name;
  }
});

const validReports: Report[] = [];

rawSeed.forEach((raw) => {
  const result = seedSchema.safeParse(raw);
  if (!result.success) {
    dropped++;
    return;
  }
  
  const data = result.data;
  
  // Re-derive action_required
  const derivedAction = getActionRequired(data.hazard_category, data.severity_level);
  if (derivedAction !== data.action_required) {
    console.warn(`Mismatch in action_required for ${data.id}. File: ${data.action_required}, App: ${derivedAction}`);
  }
  
  // Jitter if within 600m of an anchor
  const point = turf.point([data.coordinates.lng, data.coordinates.lat]);
  let nearestAnchor = null;
  let minDistance = Infinity;

  for (const anchor of anchors) {
    const anchorPoint = turf.point([anchor.lng, anchor.lat]);
    const dist = turf.distance(point, anchorPoint, { units: "meters" });
    if (dist < 600 && dist < minDistance) {
      minDistance = dist;
      nearestAnchor = anchor;
    }
  }

  let finalCoords = { ...data.coordinates };
  if (nearestAnchor && nearestAnchor.targetWard) {
    let success = false;
    for (let i = 0; i < 20; i++) {
      const jlat = nearestAnchor.lat + (Math.random() - 0.5) * 2 * 0.0012;
      const jlng = nearestAnchor.lng + (Math.random() - 0.5) * 2 * 0.0012;
      const jtag = tagWard({ lat: jlat, lng: jlng });
      if (jtag.status === "matched" && jtag.ward_name === nearestAnchor.targetWard) {
        finalCoords = { lat: jlat, lng: jlng };
        success = true;
        break;
      }
    }
    if (!success) {
      finalCoords = { lat: nearestAnchor.lat, lng: nearestAnchor.lng };
    }
  }

  // Tag ward
  const tag = tagWard(finalCoords);
  let finalLocation = data.raw_location;
  if (tag.status === "matched") {
    finalLocation = tag.ward_name;
  } else {
    unmappedCount++;
    unmappedIds.push(data.id);
  }
  
  validReports.push({
    report_id: data.id,
    hazard_category: data.hazard_category,
    severity_level: data.severity_level,
    raw_location: finalLocation,
    coordinates: finalCoords,
    action_required: derivedAction,
    transcript: data.transcript,
    createdAt: new Date(now - data.days_ago * ONE_DAY).toISOString()
  });
});

console.log(`Dropped invalid records: ${dropped}`);
console.log(`Matched wards: ${validReports.length - unmappedCount}, Unmapped: ${unmappedCount}`);
if (unmappedCount > 0) {
  console.log(`Unmapped IDs: ${unmappedIds.join(", ")}`);
}

// Verification table
const windows: [number, number, number, number] = [0, 0, 0, 0];
const cpWindows: [number, number, number, number] = [0, 0, 0, 0];
const kbWindows: [number, number, number, number] = [0, 0, 0, 0];
const lnWindows: [number, number, number, number] = [0, 0, 0, 0];
const lxWindows: [number, number, number, number] = [0, 0, 0, 0];

validReports.forEach(r => {
  const ageMs = now - new Date(r.createdAt || Date.now()).getTime();
  const weekIndex = Math.floor(ageMs / (7 * ONE_DAY));
  if (weekIndex >= 0 && weekIndex < 4) {
    const idx = weekIndex as 0 | 1 | 2 | 3;
    windows[idx] = (windows[idx] || 0) + 1;
    
    const wardName = r.raw_location;
    if (wardName === anchors.find(a => a.name === "CP")?.targetWard) cpWindows[idx]++;
    if (wardName === anchors.find(a => a.name === "KB")?.targetWard) kbWindows[idx]++;
    if (wardName === anchors.find(a => a.name === "LN")?.targetWard) lnWindows[idx]++;
    if (wardName === anchors.find(a => a.name === "LX")?.targetWard) lxWindows[idx]++;
  }
});

console.log("Verification Table (counts per 7-day window 0-3):");
console.log(`Overall: ${windows.join("/")} (Expected: 26/15/10/9)`);
console.log(`Connaught Place (${anchors.find(a => a.name === "CP")?.targetWard}): ${cpWindows.join("/")} (Expected: 8/1/0/0)`);
console.log(`Karol Bagh (${anchors.find(a => a.name === "KB")?.targetWard}): ${kbWindows.join("/")} (Expected: 6/4/2/1)`);
console.log(`Lajpat Nagar (${anchors.find(a => a.name === "LN")?.targetWard}): ${lnWindows.join("/")} (Expected: 4/4/3/4)`);
console.log(`Laxmi Nagar (${anchors.find(a => a.name === "LX")?.targetWard}): ${lxWindows.join("/")} (Expected: 3/2/1/1)`);
console.log("CP mismatch? ", cpWindows.join("/") !== "8/1/0/0" ? "Yes" : "No");
console.log("KB mismatch? ", kbWindows.join("/") !== "6/4/2/1" ? "Yes" : "No");
console.log("LN mismatch? ", lnWindows.join("/") !== "4/4/3/4" ? "Yes" : "No");
console.log("LX mismatch? ", lxWindows.join("/") !== "3/2/1/1" ? "Yes" : "No");
console.log("Overall mismatch? ", windows.join("/") !== "26/15/10/9" ? "Yes" : "No");

export const seedReports = validReports;
