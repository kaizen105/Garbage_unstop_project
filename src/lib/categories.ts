import { HazardCategory } from "@prisma/client";

export const CATEGORY_COLORS: Record<HazardCategory, string> = {
  biohazard_medical: "#ef4444",    // Red
  construction_debris: "#94a3b8",  // Slate gray
  electrical_hazard: "#f97316",    // Orange
  chemical: "#a855f7",             // Purple
  general_overflow: "#eab308",     // Yellow
  unknown: "#64748b",              // Muted slate
};

export const ALL_HAZARD_CATEGORIES: HazardCategory[] = [
  "biohazard_medical",
  "construction_debris",
  "electrical_hazard",
  "chemical",
  "general_overflow",
  "unknown",
];

export function getCategoryLabel(category: HazardCategory | string): string {
  if (category === "unknown") return "Unclassified";
  const spaced = category.replace(/_/g, " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1).toLowerCase();
}
