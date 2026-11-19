import { z } from "zod";
import { ChatOpenAI } from "@langchain/openai";
import { getEnv } from "@/lib/env";
import { extractJSON } from "./parse";

export interface ModelConfig {
  readonly id: string;
  readonly name: string;
  readonly tier: "primary" | "fallback_1" | "fallback_2";
  readonly purpose: string;
}

export const ORDERED_MODEL_STACK: readonly ModelConfig[] = [
  {
    id: "nvidia/nemotron-3.5-lightning:free",
    name: "Nemotron 3.5 Lightning",
    tier: "primary",
    purpose: "Primary high-performance structured extraction and mitigation",
  },
  {
    id: "baidu/ernie-5.5-flash-preview:free",
    name: "Baidu ERNIE 5.5 Flash Preview",
    tier: "fallback_1",
    purpose: "Independent provider fallback outside NVIDIA and Google clusters",
  },
  {
    id: "openrouter/free",
    name: "OpenRouter Dynamic Free",
    tier: "fallback_2",
    purpose: "Dynamic best-effort fallback across available endpoints",
  },
] as const;

export type FailureCategory =
  | "rate_limit_429"
  | "timeout"
  | "malformed_output"
  | "zod_validation"
  | "provider_error"
  | "network_error";

export interface ModelRoutingLog {
  workflow: "extraction" | "mitigation" | "audit";
  attemptedModel: string;
  tier: "primary" | "fallback_1" | "fallback_2" | "deterministic";
  status: "success" | "failure";
  failureCategory?: FailureCategory;
  latencyMs: number;
  servedModel?: string;
  deterministicFallbackInvoked: boolean;
}

export function logModelRouting(entry: ModelRoutingLog): void {
  const parts = [
    `[LLM Routing][${entry.workflow}]`,
    `Tier: ${entry.tier}`,
    `Model: ${entry.attemptedModel}`,
    `Status: ${entry.status}`,
    entry.failureCategory ? `Failure: ${entry.failureCategory}` : null,
    `Latency: ${Math.round(entry.latencyMs)}ms`,
    entry.servedModel ? `ServedBy: ${entry.servedModel}` : null,
    `DeterministicFallback: ${entry.deterministicFallbackInvoked}`,
  ].filter(Boolean);

  console.log(parts.join(" | "));
}

export function categorizeError(error: unknown): FailureCategory {
  const msg = error instanceof Error ? error.message : String(error);
  const lower = msg.toLowerCase();

  if (msg.includes("429") || lower.includes("rate-limited") || lower.includes("rate limit")) {
    return "rate_limit_429";
  }
  if (
    lower.includes("timeout") ||
    lower.includes("timed out") ||
    msg.includes("ETIMEDOUT") ||
    lower.includes("abort")
  ) {
    return "timeout";
  }
  if (lower.includes("zod") || lower.includes("validation")) {
    return "zod_validation";
  }
  if (
    lower.includes("null") ||
    lower.includes("malformed") ||
    lower.includes("empty") ||
    lower.includes("no json") ||
    lower.includes("missing")
  ) {
    return "malformed_output";
  }
  if (
    lower.includes("network") ||
    lower.includes("fetch failed") ||
    msg.includes("ECONNREFUSED") ||
    msg.includes("ENOTFOUND")
  ) {
    return "network_error";
  }
  return "provider_error";
}

export interface StructuredInvocationResult<T> {
  data: T | null;
  modelUsed: string;
  servedModel?: string;
  deterministicFallbackInvoked: boolean;
  attemptsCount: number;
}

export async function executeStructuredWithFallback<T>(params: {
  workflow: "extraction" | "mitigation";
  schema: z.ZodType<T>;
  systemPrompt: string;
  userPrompt: string;
  customModel?: ChatOpenAI;
  modelsOverride?: readonly ModelConfig[];
  validator?: (data: T) => boolean;
}): Promise<StructuredInvocationResult<T>> {
  const { workflow, schema, systemPrompt, userPrompt, customModel, modelsOverride, validator } = params;
  const env = getEnv();

  // If a custom model is passed directly (for testing / mocking)
  if (customModel) {
    const t0 = performance.now();
    try {
      const structuredLlm = customModel.withStructuredOutput(schema, {
        method: "functionCalling",
        includeRaw: true,
      });
      const rawResult = await structuredLlm.invoke([
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ]);

      let parsed: unknown = rawResult;
      let servedModel: string | undefined;

      if (rawResult && typeof rawResult === "object" && "parsed" in rawResult) {
        parsed = (rawResult as { parsed: unknown }).parsed;
        const rawMsg = (rawResult as { raw?: { response_metadata?: { model_name?: string; model?: string } } }).raw;
        servedModel = rawMsg?.response_metadata?.model_name || rawMsg?.response_metadata?.model;
      }

      if (parsed === null || parsed === undefined) {
        throw new Error("Received null or undefined structured output");
      }

      const validated = schema.parse(parsed);
      if (validator && !validator(validated)) {
        throw new Error("Custom validator rejected the model output");
      }

      const elapsed = performance.now() - t0;
      logModelRouting({
        workflow,
        attemptedModel: "custom",
        tier: "primary",
        status: "success",
        latencyMs: elapsed,
        servedModel,
        deterministicFallbackInvoked: false,
      });

      return {
        data: validated,
        modelUsed: "custom",
        servedModel,
        deterministicFallbackInvoked: false,
        attemptsCount: 1,
      };
    } catch (err: unknown) {
      // Secondary repair attempt for custom mock models
      try {
        const rawRes = await customModel.invoke([
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ]);
        const text = typeof rawRes.content === "string" ? rawRes.content : JSON.stringify(rawRes.content);
        const parsedJson = extractJSON(text);
        if (!parsedJson) {
          throw new Error("Could not extract JSON from raw completion");
        }
        const validated = schema.parse(parsedJson);
        if (validator && !validator(validated)) {
          throw new Error("Custom validator rejected the repaired output");
        }
        return {
          data: validated,
          modelUsed: "custom",
          deterministicFallbackInvoked: false,
          attemptsCount: 1,
        };
      } catch {
        throw err;
      }
    }
  }

  // Live sequential fallback stack
  const stack = modelsOverride || ORDERED_MODEL_STACK;
  let attemptsCount = 0;

  for (const modelConfig of stack) {
    attemptsCount++;
    const t0 = performance.now();

    try {
      const chatModel = new ChatOpenAI({
        apiKey: env.LLM_API_KEY || "dummy",
        model: modelConfig.id,
        temperature: 0,
        maxRetries: 0,
        timeout: 35000,
        configuration: {
          baseURL: env.LLM_BASE_URL,
        },
      });

      const structuredLlm = chatModel.withStructuredOutput(schema, {
        method: "functionCalling",
        includeRaw: true,
      });

      const rawResult = await structuredLlm.invoke([
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ]);

      let parsed: unknown = rawResult;
      let servedModel: string | undefined;

      if (rawResult && typeof rawResult === "object" && "parsed" in rawResult) {
        parsed = (rawResult as { parsed: unknown }).parsed;
        const rawMsg = (rawResult as { raw?: { response_metadata?: { model_name?: string; model?: string } } }).raw;
        servedModel = rawMsg?.response_metadata?.model_name || rawMsg?.response_metadata?.model;
      }

      if (parsed === null || parsed === undefined) {
        throw new Error("Structured output returned null arguments");
      }

      const validated = schema.parse(parsed);

      if (validator && !validator(validated)) {
        throw new Error("Output rejected by validation rules");
      }

      const elapsed = performance.now() - t0;
      logModelRouting({
        workflow,
        attemptedModel: modelConfig.id,
        tier: modelConfig.tier,
        status: "success",
        latencyMs: elapsed,
        servedModel,
        deterministicFallbackInvoked: false,
      });

      return {
        data: validated,
        modelUsed: modelConfig.id,
        servedModel,
        deterministicFallbackInvoked: false,
        attemptsCount,
      };
    } catch (err: unknown) {
      const elapsed = performance.now() - t0;
      const category = categorizeError(err);

      // Best-effort secondary repair only for openrouter/free dynamic router
      if (modelConfig.id === "openrouter/free") {
        try {
          const fallbackChat = new ChatOpenAI({
            apiKey: env.LLM_API_KEY || "dummy",
            model: modelConfig.id,
            temperature: 0,
            maxRetries: 0,
            timeout: 30000,
            configuration: { baseURL: env.LLM_BASE_URL },
          });

          const rawRes = await fallbackChat.invoke([
            { role: "system", content: `${systemPrompt}\nOutput strict JSON.` },
            { role: "user", content: userPrompt },
          ]);

          const text = typeof rawRes.content === "string" ? rawRes.content : JSON.stringify(rawRes.content);
          const parsedJson = extractJSON(text);

          if (parsedJson) {
            const validated = schema.parse(parsedJson);
            if (!validator || validator(validated)) {
              const rawMsg = rawRes as { response_metadata?: { model_name?: string; model?: string } };
              const servedModel = rawMsg?.response_metadata?.model_name || rawMsg?.response_metadata?.model;

              logModelRouting({
                workflow,
                attemptedModel: modelConfig.id,
                tier: modelConfig.tier,
                status: "success",
                latencyMs: performance.now() - t0,
                servedModel,
                deterministicFallbackInvoked: false,
              });

              return {
                data: validated,
                modelUsed: modelConfig.id,
                servedModel,
                deterministicFallbackInvoked: false,
                attemptsCount,
              };
            }
          }
        } catch {
          // Continue to next tier / final fallback
        }
      }

      logModelRouting({
        workflow,
        attemptedModel: modelConfig.id,
        tier: modelConfig.tier,
        status: "failure",
        failureCategory: category,
        latencyMs: elapsed,
        deterministicFallbackInvoked: false,
      });

      // Short bounded backoff if rate-limited before trying next model
      if (category === "rate_limit_429") {
        await new Promise((resolve) => setTimeout(resolve, 500));
      }
    }
  }

  // All LLM attempts exhausted: trigger deterministic fallback
  logModelRouting({
    workflow,
    attemptedModel: "deterministic_fallback",
    tier: "deterministic",
    status: "success",
    latencyMs: 0,
    deterministicFallbackInvoked: true,
  });

  return {
    data: null,
    modelUsed: "deterministic_fallback",
    deterministicFallbackInvoked: true,
    attemptsCount,
  };
}
