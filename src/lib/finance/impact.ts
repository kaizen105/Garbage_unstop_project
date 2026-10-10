import { AVOIDED_INCIDENT_COST_INR, SEVERITY_MULTIPLIER, DETOUR_COST_PER_KM_INR } from "./assumptions";

export function estimateImpact(report: { hazard_category: string, severity_level: number, action_required: string }, routes?: { planned?: { distance_m: number }, bypass?: { distance_m: number } } | null) {
  let prevented_inr = 0;
  
  if (report.action_required !== "routine_collection") {
    const baseCost = AVOIDED_INCIDENT_COST_INR[report.hazard_category] || AVOIDED_INCIDENT_COST_INR["unknown"] || 10000;
    prevented_inr = baseCost * SEVERITY_MULTIPLIER(report.severity_level);
  }

  let detour_inr = 0;
  if (routes?.planned && routes?.bypass) {
    const extraDistKm = (routes.bypass.distance_m - routes.planned.distance_m) / 1000;
    if (extraDistKm > 0) {
      detour_inr = extraDistKm * DETOUR_COST_PER_KM_INR;
    }
  }

  const net_inr = Math.max(0, prevented_inr - detour_inr);
  
  return { prevented_inr, detour_inr, net_inr };
}
