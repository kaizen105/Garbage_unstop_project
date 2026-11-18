import { describe, it, expect, vi } from "vitest";
import { POST, GET } from "./route";

vi.mock("@/lib/mitigation/service", () => ({
  generateWeeklyPlan: vi.fn().mockRejectedValue(new Error("SECRET postgres://user:pass@host")),
  getLatestCachedPlan: vi.fn().mockRejectedValue(new Error("SECRET postgres://user:pass@host")),
}));

describe("Mitigation Plan error information leak prevention", () => {
  it("does not leak secret connection strings or sensitive error details in POST 500 response", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const req = new Request("http://localhost/api/mitigation-plan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ force: true }),
    });

    const res = await POST(req);
    expect(res.status).toBe(500);

    const rawText = await res.text();
    expect(rawText).not.toContain("SECRET");
    expect(rawText).not.toContain("postgres");
    expect(rawText).not.toContain("user:pass@host");

    const json = JSON.parse(rawText);
    expect(json).toEqual({ error: "Internal server error" });

    consoleSpy.mockRestore();
  });

  it("does not leak secret connection strings or sensitive error details in GET 500 response", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await GET();
    expect(res.status).toBe(500);

    const rawText = await res.text();
    expect(rawText).not.toContain("SECRET");
    expect(rawText).not.toContain("postgres");
    expect(rawText).not.toContain("user:pass@host");

    const json = JSON.parse(rawText);
    expect(json).toEqual({ error: "Internal server error" });

    consoleSpy.mockRestore();
  });
});
