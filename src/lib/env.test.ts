import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getEnv } from "./env";

describe("getEnv", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it.each([
    ["empty values default safely", { LLM_PROVIDER: "   ", NEXT_PUBLIC_MAP_PROVIDER: "   " }, { LLM_PROVIDER: "mock", NEXT_PUBLIC_MAP_PROVIDER: "leaflet" }],
    ["quoted values are normalized", { LLM_PROVIDER: ' "OPENROUTER" ', LLM_API_KEY: " sk-123 ", LLM_MODEL_EXTRACT: " model-a ", LLM_MODEL_AUDIT: " model-b ", NEXT_PUBLIC_MAP_PROVIDER: ' "MAPBOX" ' }, { LLM_PROVIDER: "openrouter", NEXT_PUBLIC_MAP_PROVIDER: "mapbox" }],
    ["padded values are normalized", { LLM_PROVIDER: "  'evon'  ", LLM_API_KEY: "  sk-456  ", LLM_MODEL_EXTRACT: "  model-c  ", LLM_MODEL_AUDIT: "  model-d  ", NEXT_PUBLIC_MAP_PROVIDER: "  'leaflet'  " }, { LLM_PROVIDER: "evon", NEXT_PUBLIC_MAP_PROVIDER: "leaflet" }],
    ["missing values fall back to defaults", { }, { LLM_PROVIDER: "mock", NEXT_PUBLIC_MAP_PROVIDER: "leaflet" }],
  ])("handles %s", (_, input, expected) => {
    for (const [key, value] of Object.entries(input)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }

    const env = getEnv();

    expect(env.LLM_PROVIDER).toBe(expected.LLM_PROVIDER);
    expect(env.NEXT_PUBLIC_MAP_PROVIDER).toBe(expected.NEXT_PUBLIC_MAP_PROVIDER);
  });
});
