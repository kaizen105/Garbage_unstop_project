import "server-only";
import { ChatOpenAI } from "@langchain/openai";
import { getEnv } from "@/lib/env";
import { RawMitigationPlanSchema, RawMitigationPlan, HazardCategoryEnum } from "./schema";
import { MITIGATION_SYSTEM_PROMPT, formatAggregatesForPrompt } from "./prompt";
import { WeeklyAggregates } from "./types";
import { executeStructuredWithFallback } from "@/lib/llm/modelStack";

export interface MitigationChainResult {
  plan: RawMitigationPlan;
  modelUsed: string;
  servedModel?: string;
}

export function buildDeterministicFallbackPlan(aggregates: WeeklyAggregates): RawMitigationPlan {
  const top = aggregates.rows.filter((r) => r.wardKey !== "UNRESOLVED").slice(0, 3);
  return {
    headline: `Weekly Priority Mitigation Plan: Focus on ${top[0]?.wardName || "Delhi MCD"}`,
    priorities: top.map((r, i) => ({
      wardKey: r.wardKey,
      category: HazardCategoryEnum.parse(r.category),
      urgency: i === 0 ? "immediate" : "this_week",
      likelyCauses: [
        `Unregulated disposal patterns in ${r.wardName}`,
        `Delayed municipal pickup cycle for ${r.category}`,
      ],
      actions: [
        {
          owner: r.category === "biohazard_medical" ? "Biomedical Waste Inspectorate" : "MCD Zone Superintendent",
          action: `Deploy immediate cleanup fleet and initiate zone audit for ${r.category} hotspots.`,
        },
        {
          owner: "Delhi Police Vigilance",
          action: `Enforce night-time patrolling around secondary collection points in ${r.wardName}.`,
        },
      ],
    })),
    crossCuttingActions: [
      "Audit inter-ward waste transfer stations for overflow containment.",
      "Issue citizen alerts for municipal drop-off schedules.",
    ],
  };
}

export async function runMitigationChain(
  aggregates: WeeklyAggregates,
  customModel?: ChatOpenAI
): Promise<MitigationChainResult> {
  if (aggregates.rows.length === 0) {
    throw new Error("Cannot run mitigation chain on empty aggregates.");
  }

  const env = getEnv();

  // Explicit mock mode check when no custom model is supplied
  if (env.LLM_PROVIDER === "mock" && !customModel) {
    const mockPlan = buildDeterministicFallbackPlan(aggregates);
    return { plan: mockPlan, modelUsed: "mock", servedModel: "mock" };
  }

  const promptInput = formatAggregatesForPrompt(aggregates);

  // Set of valid wardKey::category keys in current aggregates for deterministic grounding check
  const validKeys = new Set(aggregates.rows.map((r) => `${r.wardKey}::${r.category}`));

  const validator = (plan: RawMitigationPlan): boolean => {
    if (!plan.priorities || plan.priorities.length === 0) return false;
    for (const p of plan.priorities) {
      if (p.wardKey === "UNRESOLVED") return false;
      const key = `${p.wardKey}::${p.category}`;
      if (!validKeys.has(key)) {
        return false;
      }
    }
    return true;
  };

  const result = await executeStructuredWithFallback({
    workflow: "mitigation",
    schema: RawMitigationPlanSchema,
    systemPrompt: MITIGATION_SYSTEM_PROMPT,
    userPrompt: `Current 7-Day Municipal Incident Aggregates:\n\n${promptInput}`,
    customModel,
    validator,
  });

  if (result.data) {
    return {
      plan: result.data,
      modelUsed: result.modelUsed,
      servedModel: result.servedModel,
    };
  }

  // Final deterministic application fallback
  const fallbackPlan = buildDeterministicFallbackPlan(aggregates);
  return {
    plan: fallbackPlan,
    modelUsed: "deterministic_fallback",
    servedModel: undefined,
  };
}
