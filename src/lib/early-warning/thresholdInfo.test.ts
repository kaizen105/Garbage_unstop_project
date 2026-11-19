import { describe, it, expect } from "vitest";
import { getRuleThresholdText, formatFlaggedReason } from "./thresholdInfo";

describe("thresholdInfo", () => {
  it("generates correct threshold description for high risk", () => {
    const text = getRuleThresholdText("high", 13);
    expect(text).toBe("score >= 2.0 and count >= 13");
  });

  it("generates correct threshold description for medium risk", () => {
    const text = getRuleThresholdText("medium");
    expect(text).toBe("score >= 1.0 or (+50% with >= 3 prior)");
  });

  it("generates correct threshold description for low risk", () => {
    const text = getRuleThresholdText("low");
    expect(text).toBe("within baseline variation");
  });

  it("formats full flagged reason line with default baseline", () => {
    const formatted = formatFlaggedReason({
      thisWeek: 15,
      risk: "high",
      anomalyScore: 2.5,
      minHigh: 13,
    });
    expect(formatted).toBe("15 reports this week, 3 baseline weeks used, threshold: score >= 2.0 and count >= 13");
  });

  it("formats full flagged reason line with custom baseline weeks", () => {
    const formatted = formatFlaggedReason({
      thisWeek: 4,
      baselineWeeks: 3,
      risk: "medium",
      anomalyScore: 1.2,
    });
    expect(formatted).toBe("4 reports this week, 3 baseline weeks used, threshold: score >= 1.0 or (+50% with >= 3 prior)");
  });
});
