/**
 * ALL NUMBERS IN THIS FILE ARE ILLUSTRATIVE ASSUMPTIONS FOR HACKATHON DEMO PURPOSES.
 * THEY DO NOT REPRESENT REAL-WORLD MUNICIPAL DATA.
 */

export const AVOIDED_INCIDENT_COST_INR: Record<string, number> = {
  biohazard_medical: 85000,
  chemical: 120000,
  electrical_hazard: 60000,
  construction_debris: 40000,
  general_overflow: 5000,
  unknown: 10000
};

export const SEVERITY_MULTIPLIER = (severity: number) => severity / 10;

export const DETOUR_COST_PER_KM_INR = 30;
