import { z } from "zod";

function normalizeEnumValue(value: string | undefined, fallback: string) {
  if (value === undefined) return fallback;

  const trimmed = value.trim();
  const withoutQuotes = trimmed.replace(/^['"]|['"]$/g, "").trim();
  const normalized = withoutQuotes.toLowerCase();

  return normalized === "" ? fallback : normalized;
}

const envSchema = z.object({
  GNANI_API_KEY: z.string().optional(),
  GNANI_STT_URL: z.string().url().default("https://api.vachana.ai/stt/v3"),
  LLM_PROVIDER: z.enum(["mock", "openrouter", "evon"]).default("openrouter"),
  LLM_BASE_URL: z.string().url().default("https://openrouter.ai/api/v1"),
  LLM_API_KEY: z.string().optional(),
  LLM_MODEL_EXTRACT: z.string().default("openai/gpt-4o-mini"),
  LLM_MODEL_AUDIT: z.string().default("openai/gpt-4o-mini"),
  NEXT_PUBLIC_MAPBOX_TOKEN: z.string().optional(),
  NEXT_PUBLIC_MAP_PROVIDER: z.enum(["leaflet", "mapbox"]).default("leaflet"),
}).superRefine((data, ctx) => {
  if (data.LLM_PROVIDER !== "mock") {
    if (!data.LLM_API_KEY) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["LLM_API_KEY"], message: "Required when LLM_PROVIDER is not mock" });
    }
  }
});

export function getEnv() {
  const llmApiKey = process.env.LLM_API_KEY || process.env.OPENROUTER_API_KEY;
  const rawProvider = process.env.LLM_PROVIDER;
  const defaultProvider = rawProvider ? normalizeEnumValue(rawProvider, "mock") : (llmApiKey ? "openrouter" : "mock");

  const normalizedEnv = {
    ...process.env,
    LLM_API_KEY: llmApiKey,
    LLM_PROVIDER: defaultProvider,
    NEXT_PUBLIC_MAP_PROVIDER: normalizeEnumValue(process.env.NEXT_PUBLIC_MAP_PROVIDER, "leaflet"),
  };

  const _env = envSchema.safeParse(normalizedEnv);

  if (!_env.success) {
    const missingKeys = _env.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join(", ");
    throw new Error(`Missing or invalid environment variables: ${missingKeys}`);
  }

  return _env.data;
}
