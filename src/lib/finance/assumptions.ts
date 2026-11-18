/**
 * Illustrative placeholder assumptions with no external source, not measured savings.
 * Used for demo impact estimation.
 */

export const AVOIDED_INCIDENT_COST_INR: Record<string, number> = {
  // Placeholder assumption for biohazard or medical waste incidents
  biohazard_medical: 85000,
  // Placeholder assumption for chemical spill incidents
  chemical: 120000,
  // Placeholder assumption for electrical hazard incidents
  electrical_hazard: 60000,
  // Placeholder assumption for construction debris incidents
  construction_debris: 40000,
  // Placeholder assumption for general overflow incidents
  general_overflow: 5000,
  // Placeholder assumption fallback for unknown hazard incidents
  unknown: 10000,
};

// Placeholder assumption for severity divisor scaling severity level (1-10) to 0.1-1.0
export const SEVERITY_DIVISOR = 10;

// Scaling multiplier based on severity level
export const SEVERITY_MULTIPLIER = (severity: number) => severity / SEVERITY_DIVISOR;

// Placeholder assumption for detour vehicle operating cost per kilometer
export const DETOUR_COST_PER_KM_INR = 30;
