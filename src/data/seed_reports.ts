import rawSeed from "../../data/seed_raw.json";
import { Report } from "@/lib/store/reports";
import { z } from "zod";
import { getActionRequired } from "@/app/api/report/route";
import { tagWard } from "@/lib/spatial/wards";

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
  
  // Tag ward
  const tag = tagWard(data.coordinates);
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
    coordinates: data.coordinates,
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

validReports.forEach(r => {
  const ageMs = now - new Date(r.createdAt || Date.now()).getTime();
  const weekIndex = Math.floor(ageMs / (7 * ONE_DAY));
  if (weekIndex >= 0 && weekIndex < 4) {
    const idx = weekIndex as 0 | 1 | 2 | 3;
    windows[idx] = (windows[idx] || 0) + 1;
    
    // Find the original raw location from the raw JSON to check the pattern
    const original = rawSeed.find(raw => raw.id === r.report_id);
    const loc = (original?.raw_location || "").toLowerCase();
    
    // Pattern for CP: expect (8/1/0/0)
    // CP is Connaught Place
    if (loc.includes("connaught place") || loc.includes("cp block") || loc.includes("cp inner") || loc.includes("cp outer")) {
      cpWindows[idx] = (cpWindows[idx] || 0) + 1;
    }
    
    // Pattern for KB: expect (6/4/2/1)
    if (loc.includes("karol bagh")) {
      kbWindows[idx] = (kbWindows[idx] || 0) + 1;
    }
  }
});

console.log("Verification Table (counts per 7-day window 0-3):");
console.log(`Overall: ${windows.join("/")} (Expected: 26/15/10/9)`);
console.log(`Connaught Place: ${cpWindows.join("/")} (Expected: 8/1/0/0)`);
console.log(`Karol Bagh: ${kbWindows.join("/")} (Expected: 6/4/2/1)`);
console.log("CP mismatch? ", cpWindows.join("/") !== "8/1/0/0" ? "Yes" : "No");
console.log("KB mismatch? ", kbWindows.join("/") !== "6/4/2/1" ? "Yes" : "No");
console.log("Overall mismatch? ", windows.join("/") !== "26/15/10/9" ? "Yes" : "No");

export const seedReports = validReports;
