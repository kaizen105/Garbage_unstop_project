import { describe, it, expect, vi } from "vitest";
import { RawMitigationPlanSchema } from "./schema";
import { groundPlan, GroundingError } from "./ground";
import { WeeklyAggregates } from "./types";
import { formatAggregatesForPrompt } from "./prompt";
import { runMitigationChain } from "./chain";

const mockAggregates: WeeklyAggregates = {
  windowStart: "2026-11-09T00:00:00.000Z",
  windowEnd: "2026-11-16T00:00:00.000Z",
  totals: {
    current7: 25,
    previous7: 10,
    synthetic7: 25,
    real7: 0,
  },
  rows: [
    {
      wardKey: "192-GREATER-KAILASH-I",
      wardName: "GREATER KAILASH-I",
      category: "biohazard_medical",
      current7: 12,
      previous7: 2,
      delta: 10,
      avgSeverity: 8.5,
      maxSeverity: 9,
      actionCounts: {
        dispatch_hazmat_bypass_standard: 12,
        bypass_standard: 0,
        routine_collection: 0,
      },
    },
    {
      wardKey: "042-ROHINI-C",
      wardName: "ROHINI-C",
      category: "chemical",
      current7: 8,
      previous7: 1,
      delta: 7,
      avgSeverity: 7.2,
      maxSeverity: 8,
      actionCounts: {
        dispatch_hazmat_bypass_standard: 8,
        bypass_standard: 0,
        routine_collection: 0,
      },
    },
  ],
};

describe("Mitigation Plan Unit Tests", () => {
  it("validates valid RawMitigationPlanSchema without incident counts", () => {
    const raw = {
      headline: "Critical Medical & Chemical Hazard Focus for South and North Delhi",
      priorities: [
        {
          wardKey: "192-GREATER-KAILASH-I",
          category: "biohazard_medical",
          urgency: "immediate",
          likelyCauses: ["Illegal clinic waste dumping", "Unregulated private nursing homes"],
          actions: [
            { owner: "Biomedical Enforcement", action: "Inspect clinics along GK-1 block M" },
          ],
        },
      ],
      crossCuttingActions: ["Mandate clinic manifest checks"],
    };

    const parsed = RawMitigationPlanSchema.parse(raw);
    expect(parsed.priorities.length).toBe(1);
    expect(parsed.headline).toBe(raw.headline);
  });

  it("grounds raw plan with real aggregate metrics correctly", () => {
    const raw = {
      headline: "Operational Priority",
      priorities: [
        {
          wardKey: "192-GREATER-KAILASH-I",
          category: "biohazard_medical" as const,
          urgency: "immediate" as const,
          likelyCauses: ["Clinical waste overflow"],
          actions: [{ owner: "Health Dept", action: "Sanitize site" }],
        },
      ],
      crossCuttingActions: [],
    };

    const grounded = groundPlan(raw, mockAggregates);
    expect(grounded.priorities[0]!.wardName).toBe("GREATER KAILASH-I");
    expect(grounded.priorities[0]!.current7).toBe(12);
    expect(grounded.priorities[0]!.previous7).toBe(2);
    expect(grounded.priorities[0]!.delta).toBe(10);
    expect(grounded.priorities[0]!.avgSeverity).toBe(8.5);
    expect(grounded.priorities[0]!.maxSeverity).toBe(9);
  });

  it("throws GroundingError if LLM hallucinates an unknown ward or category", () => {
    const raw = {
      headline: "Operational Priority",
      priorities: [
        {
          wardKey: "999-NON-EXISTENT",
          category: "biohazard_medical" as const,
          urgency: "immediate" as const,
          likelyCauses: ["Fictional event"],
          actions: [{ owner: "MCD", action: "Check" }],
        },
      ],
      crossCuttingActions: [],
    };

    expect(() => groundPlan(raw, mockAggregates)).toThrow(GroundingError);
  });

  it("throws GroundingError if LLM provides duplicate priorities", () => {
    const raw = {
      headline: "Operational Priority",
      priorities: [
        {
          wardKey: "192-GREATER-KAILASH-I",
          category: "biohazard_medical" as const,
          urgency: "immediate" as const,
          likelyCauses: ["Clinical waste"],
          actions: [{ owner: "MCD", action: "Check" }],
        },
        {
          wardKey: "192-GREATER-KAILASH-I",
          category: "biohazard_medical" as const,
          urgency: "this_week" as const,
          likelyCauses: ["More waste"],
          actions: [{ owner: "MCD", action: "Patrol" }],
        },
      ],
      crossCuttingActions: [],
    };

    expect(() => groundPlan(raw, mockAggregates)).toThrow("Duplicate priority key");
  });

  it("formats aggregates for prompt correctly", () => {
    const promptText = formatAggregatesForPrompt(mockAggregates);
    expect(promptText).toContain("GREATER KAILASH-I");
    expect(promptText).toContain("biohazard_medical");
    expect(promptText).toContain("Total incidents last 7 days: 25");
  });

  it("runs mitigation chain with mock provider", async () => {
    const { plan, modelUsed } = await runMitigationChain(mockAggregates);
    expect(modelUsed).toBe("mock");
    expect(plan.priorities.length).toBeGreaterThan(0);
    expect(plan.priorities[0]!.wardKey).toBe(mockAggregates.rows[0]!.wardKey);
  });

  it("handles chain fallback parsing when structured output fails", async () => {
    const mockModel: unknown = {
      withStructuredOutput: () => ({
        invoke: vi.fn().mockRejectedValue(new Error("Structured output failed")),
      }),
      invoke: vi.fn().mockResolvedValue({
        content: JSON.stringify({
          headline: "Fallback Plan for Rohini & GK",
          priorities: [
            {
              wardKey: "042-ROHINI-C",
              category: "chemical",
              urgency: "immediate",
              likelyCauses: ["Industrial effluent dump"],
              actions: [{ owner: "Pollution Board", action: "Seal drain" }],
            },
          ],
          crossCuttingActions: ["Industrial survey"],
        }),
      }),
    };

    const { plan } = await runMitigationChain(mockAggregates, mockModel as never);
    expect(plan.headline).toBe("Fallback Plan for Rohini & GK");
    expect(plan.priorities[0]!.wardKey).toBe("042-ROHINI-C");
  });
});
