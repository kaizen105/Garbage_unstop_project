export interface HotspotFlagReasonParams {
  thisWeek: number;
  baselineWeeks?: number;
  risk: "high" | "medium" | "low";
  anomalyScore: number;
  minHigh?: number;
  pctChange?: number;
  prevWeek?: number;
}

export function getRuleThresholdText(
  risk: "high" | "medium" | "low",
  minHigh: number = 13
): string {
  if (risk === "high") {
    return `score >= 2.0 and count >= ${minHigh}`;
  }
  if (risk === "medium") {
    return "score >= 1.0 or (+50% with >= 3 prior)";
  }
  return "within baseline variation";
}

export function formatFlaggedReason(params: HotspotFlagReasonParams): string {
  const {
    thisWeek,
    baselineWeeks = 3,
    risk,
    minHigh = 13,
  } = params;

  const thresholdText = getRuleThresholdText(risk, minHigh);
  return `${thisWeek} reports this week, ${baselineWeeks} baseline weeks used, threshold: ${thresholdText}`;
}
