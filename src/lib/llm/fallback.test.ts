import { describe, it, expect, vi, beforeEach } from "vitest";
import { z } from "zod";
import {
  executeStructuredWithFallback,
  ORDERED_MODEL_STACK,
  categorizeError,
} from "./modelStack";
import { runMitigationChain } from "@/lib/mitigation/chain";
import { WeeklyAggregates } from "@/lib/mitigation/types";
import { groundPlan } from "@/lib/mitigation/ground";

vi.mock("@/lib/env", () => ({
  getEnv: () => ({
    LLM_PROVIDER: "openrouter",
    LLM_API_KEY: "test-key",
    LLM_BASE_URL: "https://openrouter.ai/api/v1",
    LLM_MODEL_AUDIT: "nvidia/nemotron-3.5-lightning:free",
    LLM_MODEL_EXTRACT: "nvidia/nemotron-3.5-lightning:free",
  }),
}));

const mockInstanceFn = vi.fn();

vi.mock("@langchain/openai", () => {
  return {
    ChatOpenAI: class {
      constructor(params: unknown) {
        return mockInstanceFn(params);
      }
    },
  };
});

const SampleSchema = z.object({
  status: z.enum(["ok", "flagged"]),
  notes: z.string().min(1),
});

const mockAggregates: WeeklyAggregates = {
  windowStart: "2026-11-09T00:00:00.000Z",
  windowEnd: "2026-11-16T00:00:00.000Z",
  totals: { current7: 15, previous7: 5, synthetic7: 15, real7: 0 },
  rows: [
    {
      wardKey: "192-GREATER-KAILASH-I",
      wardName: "GREATER KAILASH-I",
      category: "biohazard_medical",
      current7: 10,
      previous7: 2,
      delta: 8,
      avgSeverity: 8.5,
      maxSeverity: 9,
      actionCounts: { dispatch_hazmat_bypass_standard: 10, bypass_standard: 0, routine_collection: 0 },
    },
    {
      wardKey: "042-ROHINI-C",
      wardName: "ROHINI-C",
      category: "chemical",
      current7: 5,
      previous7: 3,
      delta: 2,
      avgSeverity: 7.2,
      maxSeverity: 8,
      actionCounts: { dispatch_hazmat_bypass_standard: 5, bypass_standard: 0, routine_collection: 0 },
    },
  ],
};

describe("Sequential Model Fallback Orchestration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("categorizes errors into distinct failure modes correctly", () => {
    expect(categorizeError(new Error("429 Provider returned error: rate-limited"))).toBe("rate_limit_429");
    expect(categorizeError(new Error("Request timed out after 35000ms"))).toBe("timeout");
    expect(categorizeError(new Error("Zod validation error: Invalid enum value"))).toBe("zod_validation");
    expect(categorizeError(new Error("Received null or malformed tool payload"))).toBe("malformed_output");
    expect(categorizeError(new Error("fetch failed: ECONNREFUSED"))).toBe("network_error");
    expect(categorizeError(new Error("Internal upstream gateway 502"))).toBe("provider_error");
  });

  it("succeeds on Primary model (Nemotron 3.5 Lightning) without invoking fallbacks", async () => {
    mockInstanceFn.mockReturnValueOnce({
      withStructuredOutput: () => ({
        invoke: vi.fn().mockResolvedValue({
          parsed: { status: "ok", notes: "Clear nominal report" },
          raw: { response_metadata: { model_name: ORDERED_MODEL_STACK[0]!.id } },
        }),
      }),
      invoke: vi.fn(),
    });

    const result = await executeStructuredWithFallback({
      workflow: "extraction",
      schema: SampleSchema,
      systemPrompt: "System instruction",
      userPrompt: "Field report",
    });

    expect(result.data).toEqual({ status: "ok", notes: "Clear nominal report" });
    expect(result.modelUsed).toBe(ORDERED_MODEL_STACK[0]!.id);
    expect(result.deterministicFallbackInvoked).toBe(false);
    expect(result.attemptsCount).toBe(1);
    expect(mockInstanceFn).toHaveBeenCalledTimes(1);
  });

  it("falls back to Fallback 1 (Baidu ERNIE) when Primary returns HTTP 429", async () => {
    // Primary returns 429
    mockInstanceFn.mockReturnValueOnce({
      withStructuredOutput: () => ({
        invoke: vi.fn().mockRejectedValue(new Error("429 Provider returned error: temporarily rate-limited upstream")),
      }),
      invoke: vi.fn(),
    });

    // Fallback 1 (ERNIE) succeeds
    mockInstanceFn.mockReturnValueOnce({
      withStructuredOutput: () => ({
        invoke: vi.fn().mockResolvedValue({
          parsed: { status: "flagged", notes: "Severe medical surge in GK-1" },
          raw: { response_metadata: { model_name: ORDERED_MODEL_STACK[1]!.id } },
        }),
      }),
      invoke: vi.fn(),
    });

    const result = await executeStructuredWithFallback({
      workflow: "extraction",
      schema: SampleSchema,
      systemPrompt: "System instruction",
      userPrompt: "Field report",
    });

    expect(result.data).toEqual({ status: "flagged", notes: "Severe medical surge in GK-1" });
    expect(result.modelUsed).toBe(ORDERED_MODEL_STACK[1]!.id);
    expect(result.deterministicFallbackInvoked).toBe(false);
    expect(result.attemptsCount).toBe(2);
    expect(mockInstanceFn).toHaveBeenCalledTimes(2);
  });

  it("falls back to Fallback 1 (Baidu ERNIE) when Primary times out", async () => {
    // Primary times out
    mockInstanceFn.mockReturnValueOnce({
      withStructuredOutput: () => ({
        invoke: vi.fn().mockRejectedValue(new Error("AbortError: Operation timed out")),
      }),
      invoke: vi.fn(),
    });

    // Fallback 1 succeeds
    mockInstanceFn.mockReturnValueOnce({
      withStructuredOutput: () => ({
        invoke: vi.fn().mockResolvedValue({
          parsed: { status: "ok", notes: "Recovered via ERNIE" },
          raw: { response_metadata: { model_name: ORDERED_MODEL_STACK[1]!.id } },
        }),
      }),
      invoke: vi.fn(),
    });

    const result = await executeStructuredWithFallback({
      workflow: "extraction",
      schema: SampleSchema,
      systemPrompt: "System instruction",
      userPrompt: "Field report",
    });

    expect(result.data?.notes).toBe("Recovered via ERNIE");
    expect(result.modelUsed).toBe(ORDERED_MODEL_STACK[1]!.id);
    expect(result.attemptsCount).toBe(2);
  });

  it("falls back when Primary returns null or invalid structured output", async () => {
    // Primary returns null arguments
    mockInstanceFn.mockReturnValueOnce({
      withStructuredOutput: () => ({
        invoke: vi.fn().mockResolvedValue({
          parsed: null,
          raw: { response_metadata: { model_name: ORDERED_MODEL_STACK[0]!.id } },
        }),
      }),
      invoke: vi.fn(),
    });

    // Fallback 1 succeeds
    mockInstanceFn.mockReturnValueOnce({
      withStructuredOutput: () => ({
        invoke: vi.fn().mockResolvedValue({
          parsed: { status: "flagged", notes: "Recovered after null output" },
          raw: { response_metadata: { model_name: ORDERED_MODEL_STACK[1]!.id } },
        }),
      }),
      invoke: vi.fn(),
    });

    const result = await executeStructuredWithFallback({
      workflow: "extraction",
      schema: SampleSchema,
      systemPrompt: "System instruction",
      userPrompt: "Field report",
    });

    expect(result.data?.notes).toBe("Recovered after null output");
    expect(result.modelUsed).toBe(ORDERED_MODEL_STACK[1]!.id);
    expect(result.attemptsCount).toBe(2);
  });

  it("falls back to Fallback 2 (openrouter/free) when both Primary and ERNIE fail", async () => {
    // 1. Primary fails
    mockInstanceFn.mockReturnValueOnce({
      withStructuredOutput: () => ({
        invoke: vi.fn().mockRejectedValue(new Error("429 rate limit")),
      }),
      invoke: vi.fn(),
    });

    // 2. ERNIE fails
    mockInstanceFn.mockReturnValueOnce({
      withStructuredOutput: () => ({
        invoke: vi.fn().mockRejectedValue(new Error("503 Service Unavailable")),
      }),
      invoke: vi.fn(),
    });

    // 3. openrouter/free succeeds
    mockInstanceFn.mockReturnValueOnce({
      withStructuredOutput: () => ({
        invoke: vi.fn().mockResolvedValue({
          parsed: { status: "ok", notes: "Served by dynamic openrouter/free" },
          raw: { response_metadata: { model_name: "cohere/north-mini-code:free" } },
        }),
      }),
      invoke: vi.fn(),
    });

    const result = await executeStructuredWithFallback({
      workflow: "mitigation",
      schema: SampleSchema,
      systemPrompt: "System instruction",
      userPrompt: "Municipal aggregates",
    });

    expect(result.data?.notes).toBe("Served by dynamic openrouter/free");
    expect(result.modelUsed).toBe("openrouter/free");
    expect(result.servedModel).toBe("cohere/north-mini-code:free");
    expect(result.attemptsCount).toBe(3);
  });

  it("invokes guaranteed deterministic application fallback when all 3 LLM models fail", async () => {
    // 1. Primary fails
    mockInstanceFn.mockReturnValueOnce({
      withStructuredOutput: () => ({ invoke: vi.fn().mockRejectedValue(new Error("429 rate limit")) }),
      invoke: vi.fn(),
    });

    // 2. ERNIE fails
    mockInstanceFn.mockReturnValueOnce({
      withStructuredOutput: () => ({ invoke: vi.fn().mockRejectedValue(new Error("500 internal error")) }),
      invoke: vi.fn(),
    });

    // 3. openrouter/free fails structured and fails secondary repair
    mockInstanceFn.mockReturnValueOnce({
      withStructuredOutput: () => ({ invoke: vi.fn().mockRejectedValue(new Error("All endpoints down")) }),
      invoke: vi.fn().mockRejectedValue(new Error("Secondary repair failed")),
    });
    mockInstanceFn.mockReturnValueOnce({
      invoke: vi.fn().mockRejectedValue(new Error("Secondary repair failed")),
    });

    const result = await executeStructuredWithFallback({
      workflow: "mitigation",
      schema: SampleSchema,
      systemPrompt: "System instruction",
      userPrompt: "Municipal aggregates",
    });

    expect(result.data).toBeNull();
    expect(result.modelUsed).toBe("deterministic_fallback");
    expect(result.deterministicFallbackInvoked).toBe(true);
    expect(result.attemptsCount).toBe(3);
  });

  it("runs full mitigation workflow with deterministic fallback and passes groundPlan", async () => {
    // Simulate all models failing in chain
    mockInstanceFn.mockReturnValue({
      withStructuredOutput: () => ({ invoke: vi.fn().mockRejectedValue(new Error("All endpoints congested")) }),
      invoke: vi.fn().mockRejectedValue(new Error("Down")),
    });

    const chainResult = await runMitigationChain(mockAggregates);

    expect(chainResult.modelUsed).toBe("deterministic_fallback");
    expect(chainResult.plan.priorities.length).toBeGreaterThan(0);

    // Verify grounding against real aggregates
    const grounded = groundPlan(chainResult.plan, mockAggregates);
    expect(grounded.priorities[0]!.wardName).toBe("GREATER KAILASH-I");
    expect(grounded.priorities[0]!.current7).toBe(10);
    expect(grounded.priorities[0]!.delta).toBe(8);
  });

  it("rejects ungrounded wardKeys and triggers next fallback tier", async () => {
    // Primary returns hallucinated wardKey not in aggregates
    mockInstanceFn.mockReturnValueOnce({
      withStructuredOutput: () => ({
        invoke: vi.fn().mockResolvedValue({
          parsed: {
            headline: "Hallucinated Plan",
            priorities: [
              {
                wardKey: "999-FICTIONAL-WARD",
                category: "biohazard_medical",
                urgency: "immediate",
                likelyCauses: ["Invented cause"],
                actions: [{ owner: "MCD", action: "Patrol" }],
              },
            ],
            crossCuttingActions: [],
          },
        }),
      }),
      invoke: vi.fn(),
    });

    // Fallback 1 (ERNIE) returns grounded plan
    mockInstanceFn.mockReturnValueOnce({
      withStructuredOutput: () => ({
        invoke: vi.fn().mockResolvedValue({
          parsed: {
            headline: "Valid Grounded Plan",
            priorities: [
              {
                wardKey: "192-GREATER-KAILASH-I",
                category: "biohazard_medical",
                urgency: "immediate",
                likelyCauses: ["Clinical waste"],
                actions: [{ owner: "Biomedical Squad", action: "Sanitize" }],
              },
            ],
            crossCuttingActions: [],
          },
          raw: { response_metadata: { model_name: ORDERED_MODEL_STACK[1]!.id } },
        }),
      }),
      invoke: vi.fn(),
    });

    const chainResult = await runMitigationChain(mockAggregates);

    expect(chainResult.modelUsed).toBe(ORDERED_MODEL_STACK[1]!.id);
    expect(chainResult.plan.headline).toBe("Valid Grounded Plan");
    expect(chainResult.plan.priorities[0]!.wardKey).toBe("192-GREATER-KAILASH-I");
  });
});
