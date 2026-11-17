import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  computeWindowStart,
  computeRetryAfterSeconds,
  evaluateRateLimit,
  extractClientIp,
  checkRateLimit,
} from "./rateLimit";
import { prisma } from "@/lib/db/prisma";

describe("rateLimit pure functions", () => {
  it("computes fixed window start correctly", () => {
    // 600s window (10 mins = 600,000ms)
    // 1700000350000ms -> start should be 17000000400000 or rounded down to multiple of 600000
    const windowSeconds = 600;
    const windowMs = 600 * 1000;
    const nowMs = 1700000350000;
    const expectedStartMs = Math.floor(nowMs / windowMs) * windowMs;

    const start = computeWindowStart(nowMs, windowSeconds);
    expect(start.getTime()).toBe(expectedStartMs);
  });

  it("computes retry-after seconds until next window", () => {
    const windowSeconds = 600; // 600,000 ms
    const windowStartMs = 1700000400000;
    const nowMs = windowStartMs + 150000; // 150s into window
    // 600 - 150 = 450s remaining
    const retryAfter = computeRetryAfterSeconds(nowMs, windowSeconds);
    expect(retryAfter).toBe(450);
  });

  it("evaluates rate limit: allows when strictly under limit", () => {
    const decision = evaluateRateLimit(5, 10, 1000, 600);
    expect(decision.allowed).toBe(true);
    expect(decision.remaining).toBe(5);
    expect(decision.retryAfterSeconds).toBe(0);
  });

  it("evaluates rate limit: allows when exactly at limit", () => {
    const decision = evaluateRateLimit(10, 10, 1000, 600);
    expect(decision.allowed).toBe(true);
    expect(decision.remaining).toBe(0);
    expect(decision.retryAfterSeconds).toBe(0);
  });

  it("evaluates rate limit: denies when count exceeds limit and returns positive retry-after", () => {
    const decision = evaluateRateLimit(11, 10, 1000, 600);
    expect(decision.allowed).toBe(false);
    expect(decision.remaining).toBe(0);
    expect(decision.retryAfterSeconds).toBeGreaterThan(0);
  });

  it("resets decision when evaluated in a new window with low count", () => {
    // Previous window was at count 11 (denied)
    const oldDecision = evaluateRateLimit(11, 10, 599000, 600);
    expect(oldDecision.allowed).toBe(false);

    // New window begins, count starts back at 1
    const newDecision = evaluateRateLimit(1, 10, 601000, 600);
    expect(newDecision.allowed).toBe(true);
    expect(newDecision.remaining).toBe(9);
  });
});

describe("extractClientIp helper", () => {
  it("extracts the first IP from x-forwarded-for header", () => {
    const headers = {
      get: (name: string) => (name === "x-forwarded-for" ? "203.0.113.195, 70.41.3.18, 150.172.238.178" : null),
    };
    expect(extractClientIp(headers)).toBe("203.0.113.195");
  });

  it("falls back to x-real-ip if x-forwarded-for is missing", () => {
    const headers = {
      get: (name: string) => (name === "x-real-ip" ? "198.51.100.42" : null),
    };
    expect(extractClientIp(headers)).toBe("198.51.100.42");
  });

  it("falls back to 'unknown' when no IP headers are present", () => {
    const headers = {
      get: () => null,
    };
    expect(extractClientIp(headers)).toBe("unknown");
  });
});

describe("checkRateLimit database and fail-open behavior", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("fails open and returns allowed:true when database call throws an error", async () => {
    const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(prisma.rateLimit, "upsert").mockRejectedValue(new Error("Database connection lost"));

    const decision = await checkRateLimit("192.0.2.1");
    expect(decision.allowed).toBe(true);
    expect(consoleSpy).toHaveBeenCalledWith(
      "[RateLimit] Database check failed, failing open:",
      expect.any(Error)
    );
  });

  it("allows request when database returns count within limit", async () => {
    vi.spyOn(prisma.rateLimit, "upsert").mockResolvedValue({
      id: "test-cuid",
      key: "192.0.2.2",
      windowStart: new Date(),
      count: 3,
      updatedAt: new Date(),
    });

    const decision = await checkRateLimit("192.0.2.2");
    expect(decision.allowed).toBe(true);
    expect(decision.remaining).toBe(7);
  });

  it("denies request when database returns count exceeding limit", async () => {
    vi.spyOn(prisma.rateLimit, "upsert").mockResolvedValue({
      id: "test-cuid",
      key: "192.0.2.3",
      windowStart: new Date(),
      count: 11,
      updatedAt: new Date(),
    });

    const decision = await checkRateLimit("192.0.2.3");
    expect(decision.allowed).toBe(false);
    expect(decision.retryAfterSeconds).toBeGreaterThan(0);
  });
});
