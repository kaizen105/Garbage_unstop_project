import "server-only";
import { ChatOpenAI } from "@langchain/openai";
import { getEnv } from "@/lib/env";
import { RawMitigationPlanSchema, RawMitigationPlan } from "./schema";
import { MITIGATION_SYSTEM_PROMPT, formatAggregatesForPrompt } from "./prompt";
import { WeeklyAggregates } from "./types";
import { extractJSON } from "@/lib/llm/parse";

export interface MitigationChainResult {
  plan: RawMitigationPlan;
  modelUsed: string;
  servedModel?: string;
}

export async function runMitigationChain(
  aggregates: WeeklyAggregates,
  customModel?: ChatOpenAI
): Promise<MitigationChainResult> {
  if (aggregates.rows.length === 0) {
    throw new Error("Cannot run mitigation chain on empty aggregates.");
  }

  const env = getEnv();
  const modelName = env.LLM_MODEL_AUDIT;

  // Fallback / mock mode when LLM_PROVIDER is mock
  if (env.LLM_PROVIDER === "mock" && !customModel) {
    const top = aggregates.rows.filter((r) => r.wardKey !== "UNRESOLVED").slice(0, 3);
    const mockPlan: RawMitigationPlan = {
      headline: `Weekly Priority Mitigation Plan: Focus on ${top[0]?.wardName || "Delhi MCD"}`,
      priorities: top.map((r, i) => ({
        wardKey: r.wardKey,
        category: r.category,
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
    return { plan: mockPlan, modelUsed: "mock", servedModel: "mock" };
  }

  const model =
    customModel ??
    new ChatOpenAI({
      apiKey: env.LLM_API_KEY || "dummy",
      model: modelName,
      temperature: 0,
      maxRetries: 1,
      timeout: 30000,
      configuration: {
        baseURL: env.LLM_BASE_URL,
      },
    });

  const promptInput = formatAggregatesForPrompt(aggregates);
  const messages = [
    { role: "system" as const, content: MITIGATION_SYSTEM_PROMPT },
    { role: "user" as const, content: `Current 7-Day Municipal Incident Aggregates:\n\n${promptInput}` },
  ];

  let servedModel: string | undefined;

  try {
    const structuredLlm = model.withStructuredOutput(RawMitigationPlanSchema, { includeRaw: true });
    const rawResult = await structuredLlm.invoke(messages);
    let planData: unknown = rawResult;
    if (rawResult && typeof rawResult === "object" && "parsed" in rawResult) {
      planData = (rawResult as { parsed: unknown }).parsed;
      const rawMsg = (rawResult as { raw?: { response_metadata?: { model_name?: string; model?: string } } }).raw;
      servedModel = rawMsg?.response_metadata?.model_name || rawMsg?.response_metadata?.model;
    }
    return { plan: RawMitigationPlanSchema.parse(planData), modelUsed: modelName, servedModel };
  } catch (err: unknown) {
    console.warn("withStructuredOutput failed, attempting raw completion + repair parse:", err instanceof Error ? err.message : String(err));
    const rawRes = await model.invoke(messages);
    if (rawRes && typeof rawRes === "object") {
      const rawMsg = rawRes as { response_metadata?: { model_name?: string; model?: string } };
      servedModel = rawMsg?.response_metadata?.model_name || rawMsg?.response_metadata?.model;
    }
    const text = typeof rawRes.content === "string" ? rawRes.content : JSON.stringify(rawRes.content);
    const parsed = extractJSON(text);
    if (!parsed) {
      throw new Error(`Failed to parse mitigation plan from model response: ${text.slice(0, 200)}`);
    }
    return { plan: RawMitigationPlanSchema.parse(parsed), modelUsed: modelName, servedModel };
  }
}
