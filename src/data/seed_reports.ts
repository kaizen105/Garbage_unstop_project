import { Report } from "@/lib/store/reports";

// Connaught place approx: 28.6315, 77.2167
const ONE_DAY = 24 * 60 * 60 * 1000;
const now = Date.now();

export const seedReports: Report[] = [
  // Spike in CP (this week)
  { report_id: "HZ-CP1", transcript: "Lots of rubble near CP inner circle", hazard_category: "construction_debris", severity_level: 8, raw_location: "Connaught Place", action_required: "dispatch_hazmat_bypass_standard", createdAt: new Date(now - 1 * ONE_DAY).toISOString(), coordinates: { lat: 28.632, lng: 77.217 } },
  { report_id: "HZ-CP2", transcript: "Exposed wires and debris on radial road", hazard_category: "electrical_hazard", severity_level: 9, raw_location: "CP block A", action_required: "dispatch_hazmat_bypass_standard", createdAt: new Date(now - 2 * ONE_DAY).toISOString(), coordinates: { lat: 28.631, lng: 77.218 } },
  { report_id: "HZ-CP3", transcript: "Heavy construction waste blocking road", hazard_category: "construction_debris", severity_level: 7, raw_location: "CP Middle Circle", action_required: "bypass_standard", createdAt: new Date(now - 3 * ONE_DAY).toISOString(), coordinates: { lat: 28.633, lng: 77.216 } },
  { report_id: "HZ-CP4", transcript: "Electric pole fallen with demolition waste", hazard_category: "electrical_hazard", severity_level: 10, raw_location: "Connaught Place outer", action_required: "dispatch_hazmat_bypass_standard", createdAt: new Date(now - 4 * ONE_DAY).toISOString(), coordinates: { lat: 28.630, lng: 77.215 } },
  
  // Last week CP (normal baseline)
  { report_id: "HZ-CP5", transcript: "Some minor debris", hazard_category: "construction_debris", severity_level: 3, raw_location: "Connaught Place", action_required: "routine_collection", createdAt: new Date(now - 10 * ONE_DAY).toISOString(), coordinates: { lat: 28.6315, lng: 77.2167 } },
  
  // Random other this week
  { report_id: "HZ-OTH1", transcript: "Medical waste dumped", hazard_category: "biohazard_medical", severity_level: 9, raw_location: "Lajpat Nagar", action_required: "dispatch_hazmat_bypass_standard", createdAt: new Date(now - 2 * ONE_DAY).toISOString(), coordinates: { lat: 28.567, lng: 77.243 } },
  { report_id: "HZ-OTH2", transcript: "Overflowing bin", hazard_category: "general_overflow", severity_level: 4, raw_location: "Karol Bagh", action_required: "routine_collection", createdAt: new Date(now - 5 * ONE_DAY).toISOString(), coordinates: { lat: 28.652, lng: 77.190 } },
  
  // Generate more random ones to reach 26
  ...Array.from({ length: 19 }).map((_, i) => ({
    report_id: `HZ-RND${i}`,
    transcript: `Random report ${i}`,
    hazard_category: ["general_overflow", "chemical", "unknown"][i % 3] as string,
    severity_level: (i % 5) + 3,
    raw_location: `Location ${i}`,
    action_required: "routine_collection",
    createdAt: new Date(now - (i % 14) * ONE_DAY).toISOString(),
    coordinates: {
      lat: 28.5 + Math.random() * 0.3,
      lng: 77.0 + Math.random() * 0.3
    }
  }))
];
