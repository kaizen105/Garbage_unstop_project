import { describe, it, expect, vi, beforeEach } from "vitest";
import { runAuditFromCluster, AnomalyCluster } from "./audit";
import * as provider from "@/lib/llm/provider";
import fs from "node:fs";
import path from "node:path";

vi.mock("@/lib/llm/provider", () => ({
  chatWithMeta: vi.fn(),
  chat: vi.fn(),
}));

vi.mock("@/lib/env", () => ({
  getEnv: vi.fn(() => ({
    LLM_PROVIDER: "openrouter",
    LLM_MODEL_AUDIT: "openrouter/free",
    LLM_MODEL_EXTRACT: "openrouter/free",
    LLM_BASE_URL: "https://openrouter.ai/api/v1",
    LLM_API_KEY: "dummy-key",
  })),
}));

const sampleCluster: AnomalyCluster = {
  ward: "ROHINI-C",
  category: "chemical",
  this_week: 10,
  prev_week: 2,
  pct_increase: 400,
  centroid: { lat: 28.7, lng: 77.1 },
};

describe("Weekly Audit Unit Tests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("reads model from getEnv and verifies 'gpt-4o-mini' appears nowhere in src", async () => {
    const chatMock = vi.mocked(provider.chatWithMeta);
    chatMock.mockResolvedValueOnce({
      content: JSON.stringify({
        ward: "ROHINI-C",
        dominant_anomaly: "Spike in chemical",
        root_cause_analysis: "Industrial runoff",
        audit_recommendation: "Inspect factories",
      }),
      servedModel: "meta-llama/llama-3.3-70b-instruct:free",
    });

    await runAuditFromCluster(sampleCluster);
    expect(chatMock).toHaveBeenCalledWith(
      expect.any(Array),
      "openrouter/free"
    );

    // Verify 'gpt-4o-mini' does not appear anywhere in src files
    const srcDir = path.resolve(__dirname, "../../");
    function assertNoGpt4oMini(dir: string) {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          assertNoGpt4oMini(fullPath);
        } else if (entry.isFile() && (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx"))) {
          if (fullPath === __filename) continue;
          const content = fs.readFileSync(fullPath, "utf-8");
          expect(content).not.toContain("gpt-4o-mini");
        }
      }
    }
    assertNoGpt4oMini(srcDir);
  });

  it("returns source 'llm' and records served model on success", async () => {
    const chatMock = vi.mocked(provider.chatWithMeta);
    chatMock.mockResolvedValueOnce({
      content: JSON.stringify({
        ward: "ROHINI-C",
        dominant_anomaly: "Spike in chemical",
        root_cause_analysis: "Industrial runoff",
        audit_recommendation: "Inspect factories",
      }),
      servedModel: "meta-llama/llama-3.3-70b-instruct:free",
    });

    const result = await runAuditFromCluster(sampleCluster);
    expect(result.status).toBe("success");
    expect(result.source).toBe("llm");
    expect(result.model).toBe("openrouter/free (served by meta-llama/llama-3.3-70b-instruct:free)");
    expect(result.servedModel).toBe("meta-llama/llama-3.3-70b-instruct:free");
    expect(result.dominant_anomaly).toBe("Spike in chemical");
  });

  it("returns source 'template_fallback' on audit failure", async () => {
    const chatMock = vi.mocked(provider.chatWithMeta);
    chatMock.mockRejectedValue(new Error("LLM network timeout"));

    const result = await runAuditFromCluster(sampleCluster);
    expect(result.status).toBe("success");
    expect(result.source).toBe("template_fallback");
    expect(result.model).toBe("mock");
    expect(result.dominant_anomaly).toBe("Spike in chemical");
  });
});
