import { describe, it, expect } from "vitest";
import { timeStage, TraceStage } from "./trace";

describe("timeStage Unit Tests", () => {
  it("records ms and ok on success, adds detail when provided, and returns the function value", async () => {
    const stages: TraceStage[] = [];
    const result = await timeStage(
      stages,
      "Test stage",
      async () => {
        return { data: "success_value" };
      },
      (res) => `detail: ${res.data}`
    );

    expect(result).toEqual({ data: "success_value" });
    expect(stages.length).toBe(1);
    expect(stages[0]?.stage).toBe("Test stage");
    expect(stages[0]?.ok).toBe(true);
    expect(stages[0]?.detail).toBe("detail: success_value");
    expect(typeof stages[0]?.ms).toBe("number");
    expect(stages[0]!.ms).toBeGreaterThanOrEqual(0);
  });

  it("records ok:false, captures elapsed time, and re-throws on error", async () => {
    const stages: TraceStage[] = [];
    const expectedError = new Error("Stage failed unexpectedly");

    await expect(
      timeStage(stages, "Failing stage", async () => {
        throw expectedError;
      })
    ).rejects.toThrow("Stage failed unexpectedly");

    expect(stages.length).toBe(1);
    expect(stages[0]?.stage).toBe("Failing stage");
    expect(stages[0]?.ok).toBe(false);
    expect(stages[0]?.detail).toBeUndefined();
    expect(typeof stages[0]?.ms).toBe("number");
    expect(stages[0]!.ms).toBeGreaterThanOrEqual(0);
  });
});
