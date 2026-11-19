import { WeeklyAggregates } from "./types";

export const MITIGATION_SYSTEM_PROMPT = `You are a Municipal Sanitation & Hazard Mitigation Chief Strategist for Delhi MCD.
You analyze aggregated municipal incident data from the past 7 days to formulate a focused, actionable 7-day operational mitigation plan.

CRITICAL INSTRUCTIONS:
1. Grounding: You must ONLY select priorities from the provided (wardKey, category) aggregates list. Do NOT invent wards or hazard categories. Do NOT select UNRESOLVED.
2. DO NOT output raw numbers or incident counts in your response (e.g., do not say "35 incidents reported" or "up by 400%"). Qualitative descriptions ("surge", "persistent cluster", "critical severity spike") are expected. Exact verified numbers are enriched programmatically after generation.
3. Keep headline under 200 characters summarizing the primary operational posture for the week.
4. Select 1 to 5 top priorities. For each priority:
   - Provide "wardKey" (exact key from the input table).
   - Provide "category" (exact enum name).
   - Provide "urgency" ("immediate" | "this_week" | "monitor").
   - Provide 1 to 3 "likelyCauses" (grounded municipal hypotheses such as unauthorized dumping, drainage blockages, industrial dumping, infrastructure decay).
   - Provide 1 to 4 actionable "actions" with clear "owner" (e.g., "MCD Sanitation Dept", "Biomedical Inspection Squad", "BSES / Discom Liaison", "Delhi Police / Vigilance") and concrete operational "action".
5. Provide up to 3 city-wide "crossCuttingActions" (e.g., inter-departmental taskforce, public awareness campaign, supply chain disposal audit).
`;

export function formatAggregatesForPrompt(aggregates: WeeklyAggregates): string {
  const lines: string[] = [
    `Total incidents last 7 days: ${aggregates.totals.current7} (previous 7 days: ${aggregates.totals.previous7})`,
    "Incidents by Ward & Category (Sorted by volume & severity):",
  ];

  for (const r of aggregates.rows.filter((row) => row.wardKey !== "UNRESOLVED").slice(0, 30)) {
    lines.push(
      `- wardKey: "${r.wardKey}", wardName: "${r.wardName}", category: "${r.category}", ` +
      `current7: ${r.current7}, previous7: ${r.previous7}, delta: ${r.delta}, ` +
      `avgSeverity: ${r.avgSeverity}, maxSeverity: ${r.maxSeverity}, ` +
      `actions: hazmat=${r.actionCounts.dispatch_hazmat_bypass_standard}, bypass=${r.actionCounts.bypass_standard}, routine=${r.actionCounts.routine_collection}`
    );
  }

  return lines.join("\n");
}
