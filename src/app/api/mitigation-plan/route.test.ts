import { describe, it, expect, vi, beforeEach } from "vitest";
import { POST, GET } from "./route";
import {
  generateWeeklyPlan,
  getFreshCachedPlan,
  getLatestCachedPlan,
  GeneratePlanResult,
} from "@/lib/mitigation/service";
import { checkRateLimit, extractClientIp } from "@/lib/rateLimit";
import {
  tryAcquireMitigationLock,
  releaseMitigationLock,
} from "@/lib/mitigation/lock";

vi.mock("@/lib/mitigation/service", () => ({
  generateWeeklyPlan: vi.fn(),
  getFreshCachedPlan: vi.fn(),
  getLatestCachedPlan: vi.fn(),
}));

vi.mock("@/lib/rateLimit", () => ({
  checkRateLimit: vi.fn(),
  extractClientIp: vi.fn(),
}));

vi.mock("@/lib/mitigation/lock", () => ({
  tryAcquireMitigationLock: vi.fn(),
  releaseMitigationLock: vi.fn(),
}));

vi.mock("@/lib/env", () => ({
  getEnv: vi.fn(() => ({
    RATE_LIMIT_MITIGATION_PER_IP_MAX: 5,
    RATE_LIMIT_MITIGATION_GLOBAL_MAX: 20,
    RATE_LIMIT_MAX: 10,
    RATE_LIMIT_WINDOW_SECONDS: 600,
  })),
}));

const mockGenerateWeeklyPlan = vi.mocked(generateWeeklyPlan);
const mockGetFreshCachedPlan = vi.mocked(getFreshCachedPlan);
const mockGetLatestCachedPlan = vi.mocked(getLatestCachedPlan);
const mockCheckRateLimit = vi.mocked(checkRateLimit);
const mockExtractClientIp = vi.mocked(extractClientIp);
const mockTryAcquireMitigationLock = vi.mocked(tryAcquireMitigationLock);
const mockReleaseMitigationLock = vi.mocked(releaseMitigationLock);

describe("POST /api/mitigation-plan rate limiting and concurrency", () => {
  const samplePlan: GeneratePlanResult = {
    status: "ok",
    plan: {
      title: "Weekly Plan",
      strategy: "Targeted Cleanup",
      wardAssignments: [],
      contingencyNotes: "",
      unmatchedDirectives: [],
    } as unknown as GeneratePlanResult["plan"],
    aggregates: {
      windowStart: "2026-11-10T00:00:00.000Z",
      windowEnd: "2026-11-17T00:00:00.000Z",
      totals: { current7: 12, previous7: 10, synthetic7: 0, real7: 12 },
      rows: [],
    },
    generatedAt: "2026-11-18T10:00:00.000Z",
    cached: true,
    includesSynthetic: false,
    model: "mock-model",
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockExtractClientIp.mockReturnValue("198.51.100.42");
    mockGetFreshCachedPlan.mockResolvedValue(null);
    mockGetLatestCachedPlan.mockResolvedValue({
      status: "no_data",
      generatedAt: new Date().toISOString(),
      cached: true,
      includesSynthetic: false,
      model: "none",
    });
    mockCheckRateLimit.mockResolvedValue({
      allowed: true,
      limit: 10,
      remaining: 9,
      retryAfterSeconds: 0,
    });
    mockTryAcquireMitigationLock.mockResolvedValue(true);
    mockReleaseMitigationLock.mockResolvedValue(undefined);
    mockGenerateWeeklyPlan.mockResolvedValue({
      ...samplePlan,
      cached: false,
    });
  });

  it("fresh cache hit returns immediately without touching limiters or lock", async () => {
    mockGetFreshCachedPlan.mockResolvedValueOnce(samplePlan);

    const req = new Request("http://localhost/api/mitigation-plan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ force: false }),
    });

    const res = await POST(req);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body).toEqual(samplePlan);

    expect(mockGetFreshCachedPlan).toHaveBeenCalledTimes(1);
    expect(mockCheckRateLimit).not.toHaveBeenCalled();
    expect(mockTryAcquireMitigationLock).not.toHaveBeenCalled();
    expect(mockGenerateWeeklyPlan).not.toHaveBeenCalled();
  });

  it("cache miss checks rate limits, acquires lock, generates plan, and releases lock", async () => {
    mockGetFreshCachedPlan.mockResolvedValueOnce(null);

    const req = new Request("http://localhost/api/mitigation-plan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ force: false }),
    });

    const res = await POST(req);
    expect(res.status).toBe(200);

    expect(mockCheckRateLimit).toHaveBeenCalledWith("mitigation:global", {
      limit: 20,
      windowSeconds: 3600,
    });
    expect(mockCheckRateLimit).toHaveBeenCalledWith("mitigation:198.51.100.42", {
      limit: 5,
      windowSeconds: 600,
    });
    expect(mockTryAcquireMitigationLock).toHaveBeenCalledTimes(1);
    expect(mockGenerateWeeklyPlan).toHaveBeenCalledWith({ force: true });
    expect(mockReleaseMitigationLock).toHaveBeenCalledTimes(1);
  });

  it("per-IP rate limit exceeded returns HTTP 429 with Retry-After and does not generate", async () => {
    mockGetFreshCachedPlan.mockResolvedValueOnce(null);
    mockCheckRateLimit.mockImplementation(async (key: string) => {
      if (key === "mitigation:global") {
        return { allowed: true, limit: 20, remaining: 19, retryAfterSeconds: 0 };
      }
      return { allowed: false, limit: 5, remaining: 0, retryAfterSeconds: 120 };
    });

    const req = new Request("http://localhost/api/mitigation-plan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ force: true }),
    });

    const res = await POST(req);
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("120");

    const body = await res.json();
    expect(body).toEqual({
      error: "RATE_LIMITED",
      message: "Rate limit exceeded. Please wait 120 seconds before requesting another mitigation plan.",
      retryAfter: 120,
    });

    expect(mockTryAcquireMitigationLock).not.toHaveBeenCalled();
    expect(mockGenerateWeeklyPlan).not.toHaveBeenCalled();
  });

  it("global cap exceeded serves stale cached plan when one exists", async () => {
    mockGetFreshCachedPlan.mockResolvedValueOnce(null);
    mockCheckRateLimit.mockResolvedValueOnce({
      allowed: false,
      limit: 20,
      remaining: 0,
      retryAfterSeconds: 1800,
    });
    mockGetLatestCachedPlan.mockResolvedValueOnce({
      ...samplePlan,
      stale: true,
    });

    const req = new Request("http://localhost/api/mitigation-plan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ force: true }),
    });

    const res = await POST(req);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.stale).toBe(true);
    expect(mockGetLatestCachedPlan).toHaveBeenCalledWith({ stale: true });
    expect(mockTryAcquireMitigationLock).not.toHaveBeenCalled();
    expect(mockGenerateWeeklyPlan).not.toHaveBeenCalled();
  });

  it("global cap exceeded returns HTTP 429 when no cached plan exists", async () => {
    mockGetFreshCachedPlan.mockResolvedValueOnce(null);
    mockCheckRateLimit.mockResolvedValueOnce({
      allowed: false,
      limit: 20,
      remaining: 0,
      retryAfterSeconds: 1800,
    });
    mockGetLatestCachedPlan.mockResolvedValueOnce({
      status: "no_data",
      generatedAt: new Date().toISOString(),
      cached: true,
      includesSynthetic: false,
      model: "none",
    });

    const req = new Request("http://localhost/api/mitigation-plan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ force: true }),
    });

    const res = await POST(req);
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("1800");

    const body = await res.json();
    expect(body.error).toBe("RATE_LIMITED");
    expect(mockGenerateWeeklyPlan).not.toHaveBeenCalled();
  });

  it("lost lock returns latest cached plan flagged stale when available", async () => {
    mockGetFreshCachedPlan.mockResolvedValueOnce(null);
    mockTryAcquireMitigationLock.mockResolvedValueOnce(false);
    mockGetLatestCachedPlan.mockResolvedValueOnce({
      ...samplePlan,
      stale: true,
    });

    const req = new Request("http://localhost/api/mitigation-plan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ force: false }),
    });

    const res = await POST(req);
    expect(res.status).toBe(200);

    const body = await res.json();
    expect(body.stale).toBe(true);
    expect(mockGenerateWeeklyPlan).not.toHaveBeenCalled();
    expect(mockReleaseMitigationLock).not.toHaveBeenCalled();
  });

  it("lost lock returns HTTP 202 GENERATING when no cached plan exists", async () => {
    mockGetFreshCachedPlan.mockResolvedValueOnce(null);
    mockTryAcquireMitigationLock.mockResolvedValueOnce(false);
    mockGetLatestCachedPlan.mockResolvedValueOnce({
      status: "no_data",
      generatedAt: new Date().toISOString(),
      cached: true,
      includesSynthetic: false,
      model: "none",
    });

    const req = new Request("http://localhost/api/mitigation-plan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ force: false }),
    });

    const res = await POST(req);
    expect(res.status).toBe(202);

    const body = await res.json();
    expect(body).toEqual({ status: "GENERATING" });
    expect(mockGenerateWeeklyPlan).not.toHaveBeenCalled();
  });

  it("lock is released in finally even if generation throws an error", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockGetFreshCachedPlan.mockResolvedValueOnce(null);
    mockGenerateWeeklyPlan.mockRejectedValueOnce(new Error("LLM failure"));

    const req = new Request("http://localhost/api/mitigation-plan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ force: true }),
    });

    const res = await POST(req);
    expect(res.status).toBe(500);

    expect(mockReleaseMitigationLock).toHaveBeenCalledTimes(1);
    consoleSpy.mockRestore();
  });
});

describe("Mitigation Plan error information leak prevention", () => {
  it("does not leak secret connection strings or sensitive error details in POST 500 response", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockGenerateWeeklyPlan.mockRejectedValueOnce(new Error("SECRET postgres://user:pass@host"));

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
    const mockGetLatestCachedPlan = vi.mocked(getLatestCachedPlan);
    mockGetLatestCachedPlan.mockRejectedValueOnce(new Error("SECRET postgres://user:pass@host"));

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
