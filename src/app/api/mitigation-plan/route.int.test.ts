import { describe, it, expect, vi } from "vitest";
import { POST } from "./route";

describe("POST /api/mitigation-plan", () => {
  it("returns weekly mitigation plan with grounded priorities", async () => {
    // Set LLM_PROVIDER to mock for deterministic offline execution in integration test
    const origEnv = process.env.LLM_PROVIDER;
    process.env.LLM_PROVIDER = "mock";

    try {
      const req = new Request("http://localhost/api/mitigation-plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ force: true }),
      });

      const res = await POST(req);
      expect(res.status).toBe(200);

      const json = await res.json();
      expect(json.status).toBe("ok");
      expect(json.plan).toBeDefined();
      expect(json.plan.headline).toBeDefined();
      expect(json.plan.priorities.length).toBeGreaterThan(0);
      expect(json.aggregates).toBeDefined();
      expect(json.aggregates.totals.current7).toBeGreaterThan(0);
      expect(json.model).toBe("mock");
    } finally {
      process.env.LLM_PROVIDER = origEnv;
    }
  });
});
