import { z } from "zod";

const envSchema = z.object({
  GNANI_API_KEY: z.string().optional(),
  GNANI_STT_URL: z.string().url().default("https://api.vachana.ai/stt/v3"),
  LLM_PROVIDER: z.enum(["mock", "openrouter", "evon"]).default("mock"),
  LLM_BASE_URL: z.string().url().default("https://openrouter.ai/api/v1"),
  LLM_API_KEY: z.string().optional(),
  LLM_MODEL_EXTRACT: z.string().optional(),
  LLM_MODEL_AUDIT: z.string().optional(),
  NEXT_PUBLIC_MAPBOX_TOKEN: z.string().optional(),
  NEXT_PUBLIC_MAP_PROVIDER: z.enum(["leaflet", "mapbox"]).default("leaflet"),
}).superRefine((data, ctx) => {
  if (data.LLM_PROVIDER !== "mock") {
    if (!data.LLM_API_KEY) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["LLM_API_KEY"], message: "Required when LLM_PROVIDER is not mock" });
    }
    if (!data.LLM_MODEL_EXTRACT) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["LLM_MODEL_EXTRACT"], message: "Required when LLM_PROVIDER is not mock" });
    }
    if (!data.LLM_MODEL_AUDIT) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["LLM_MODEL_AUDIT"], message: "Required when LLM_PROVIDER is not mock" });
    }
  }
});

export function getEnv() {
  const _env = envSchema.safeParse(process.env);

  if (!_env.success) {
    const missingKeys = _env.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join(", ");
    throw new Error(`Missing or invalid environment variables: ${missingKeys}`);
  }

  return _env.data;
}
