import { Report } from "@/lib/store/reports";

// Connaught place approx: 28.6315, 77.2167
const ONE_DAY = 24 * 60 * 60 * 1000;
const now = Date.now();

const generateBase = (idPrefix: string, baseTimeOffset: number, count: number, category: string, centerLat: number, centerLng: number, locPrefix: string) => {
  return Array.from({ length: count }).map((_, i) => ({
    report_id: `HZ-${idPrefix}-${i}`,
    transcript: `Synthetic report ${i} for ${category}`,
    hazard_category: category,
    severity_level: Math.floor(Math.random() * 5) + 4,
    raw_location: `${locPrefix} area ${i}`,
    action_required: category.includes("biohazard") || category.includes("chemical") ? "dispatch_hazmat_bypass_standard" : "routine_collection",
    createdAt: new Date(now - baseTimeOffset - (Math.random() * 3 * ONE_DAY)).toISOString(),
    coordinates: {
      lat: centerLat + (Math.random() - 0.5) * 0.02,
      lng: centerLng + (Math.random() - 0.5) * 0.02
    }
  }));
};

export const seedReports: Report[] = [
  // Spike in CP (this week)
  { report_id: "HZ-CP1", transcript: "Lots of rubble near CP inner circle", hazard_category: "construction_debris", severity_level: 8, raw_location: "Connaught Place", action_required: "dispatch_hazmat_bypass_standard", createdAt: new Date(now - 1 * ONE_DAY).toISOString(), coordinates: { lat: 28.632, lng: 77.217 } },
  { report_id: "HZ-CP2", transcript: "Exposed wires and debris on radial road", hazard_category: "electrical_hazard", severity_level: 9, raw_location: "CP block A", action_required: "dispatch_hazmat_bypass_standard", createdAt: new Date(now - 2 * ONE_DAY).toISOString(), coordinates: { lat: 28.631, lng: 77.218 } },
  { report_id: "HZ-CP3", transcript: "Heavy construction waste blocking road", hazard_category: "construction_debris", severity_level: 7, raw_location: "CP Middle Circle", action_required: "bypass_standard", createdAt: new Date(now - 3 * ONE_DAY).toISOString(), coordinates: { lat: 28.633, lng: 77.216 } },
  { report_id: "HZ-CP4", transcript: "Electric pole fallen with demolition waste", hazard_category: "electrical_hazard", severity_level: 10, raw_location: "Connaught Place outer", action_required: "dispatch_hazmat_bypass_standard", createdAt: new Date(now - 4 * ONE_DAY).toISOString(), coordinates: { lat: 28.630, lng: 77.215 } },
  
  // Last week CP (normal baseline)
  { report_id: "HZ-CP5", transcript: "Some minor debris", hazard_category: "construction_debris", severity_level: 3, raw_location: "Connaught Place", action_required: "routine_collection", createdAt: new Date(now - 10 * ONE_DAY).toISOString(), coordinates: { lat: 28.6315, lng: 77.2167 } },
  
  // Gradual rise in biohazard_medical in Lajpat Nagar over 4 weeks (1 -> 2 -> 4 -> 6)
  ...generateBase("LN-W3", 21 * ONE_DAY, 1, "biohazard_medical", 28.567, 77.243, "Lajpat Nagar"),
  ...generateBase("LN-W2", 14 * ONE_DAY, 2, "biohazard_medical", 28.567, 77.243, "Lajpat Nagar"),
  ...generateBase("LN-W1", 7 * ONE_DAY, 4, "biohazard_medical", 28.567, 77.243, "Lajpat Nagar"),
  ...generateBase("LN-W0", 0 * ONE_DAY, 6, "biohazard_medical", 28.567, 77.243, "Lajpat Nagar"),

  // Gradual rise in chemical in Karol Bagh over 4 weeks (0 -> 1 -> 2 -> 4)
  ...generateBase("KB-W2", 14 * ONE_DAY, 1, "chemical", 28.652, 77.190, "Karol Bagh"),
  ...generateBase("KB-W1", 7 * ONE_DAY, 2, "chemical", 28.652, 77.190, "Karol Bagh"),
  ...generateBase("KB-W0", 0 * ONE_DAY, 4, "chemical", 28.652, 77.190, "Karol Bagh"),
  
  // Random noise over 4 weeks to pad up to ~60
  ...Array.from({ length: 35 }).map((_, i) => ({
    report_id: `HZ-RND${i}`,
    transcript: `Random report ${i}`,
    hazard_category: ["general_overflow", "chemical", "unknown", "dead_animal"][i % 4] as string,
    severity_level: (i % 5) + 3,
    raw_location: `Location ${i}`,
    action_required: "routine_collection",
    createdAt: new Date(now - (Math.random() * 28) * ONE_DAY).toISOString(),
    coordinates: {
      lat: 28.5 + Math.random() * 0.3,
      lng: 77.0 + Math.random() * 0.3
    }
  }))
];
