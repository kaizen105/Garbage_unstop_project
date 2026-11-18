import { prisma } from "@/lib/db/prisma";
import { getEnv } from "@/lib/env";

export interface RateLimitDecision {
  allowed: boolean;
  limit: number;
  remaining: number;
  retryAfterSeconds: number;
}

/**
 * Pure function: calculates the start of the current fixed window for a given timestamp.
 */
export function computeWindowStart(nowMs: number, windowSeconds: number): Date {
  const windowMs = Math.max(1, windowSeconds) * 1000;
  const startMs = Math.floor(nowMs / windowMs) * windowMs;
  return new Date(startMs);
}

/**
 * Pure function: calculates retry-after seconds until the next window begins.
 */
export function computeRetryAfterSeconds(nowMs: number, windowSeconds: number): number {
  const windowMs = Math.max(1, windowSeconds) * 1000;
  const elapsedInWindow = nowMs % windowMs;
  const remainingMs = windowMs - elapsedInWindow;
  return Math.max(1, Math.ceil(remainingMs / 1000));
}

/**
 * Pure decision logic given current count and limit.
 */
export function evaluateRateLimit(
  currentCount: number,
  limit: number,
  nowMs: number,
  windowSeconds: number
): RateLimitDecision {
  if (currentCount <= limit) {
    return {
      allowed: true,
      limit,
      remaining: Math.max(0, limit - currentCount),
      retryAfterSeconds: 0,
    };
  }

  return {
    allowed: false,
    limit,
    remaining: 0,
    retryAfterSeconds: computeRetryAfterSeconds(nowMs, windowSeconds),
  };
}

/**
 * Extracts client IP from headers.
 * Prefers the first IP in x-forwarded-for, then x-real-ip, falling back to 'unknown'.
 */
export function extractClientIp(headerGetter: { get: (name: string) => string | null }): string {
  const forwardedFor = headerGetter.get("x-forwarded-for");
  if (forwardedFor) {
    const first = forwardedFor.split(",")[0]?.trim();
    if (first) return first;
  }
  const realIp = headerGetter.get("x-real-ip");
  if (realIp && realIp.trim()) {
    return realIp.trim();
  }
  return "unknown";
}

/**
 * Server function: performs atomic upsert increment on RateLimit table.
 * Fails open if database operation throws.
 */
export async function checkRateLimit(
  clientKey: string,
  options?: { limit?: number; windowSeconds?: number }
): Promise<RateLimitDecision> {
  const env = getEnv();
  const limit = options?.limit ?? env.RATE_LIMIT_MAX;
  const windowSeconds = options?.windowSeconds ?? env.RATE_LIMIT_WINDOW_SECONDS;
  const nowMs = Date.now();
  const windowStart = computeWindowStart(nowMs, windowSeconds);

  try {
    const record = await prisma.rateLimit.upsert({
      where: {
        key_windowStart: {
          key: clientKey,
          windowStart,
        },
      },
      create: {
        key: clientKey,
        windowStart,
        count: 1,
      },
      update: {
        count: { increment: 1 },
      },
    });

    // Low-frequency cleanup of records older than 24 hours (1 in 50 requests)
    if (Math.random() < 0.02) {
      const oneDayAgo = new Date(nowMs - 24 * 60 * 60 * 1000);
      prisma.rateLimit.deleteMany({
        where: { windowStart: { lt: oneDayAgo } },
      }).catch((err) => {
        console.warn("[RateLimit] Background cleanup error:", err);
      });
    }

    return evaluateRateLimit(record.count, limit, nowMs, windowSeconds);
  } catch (error) {
    console.warn("[RateLimit] Database check failed, failing open:", error);
    return {
      allowed: true,
      limit,
      remaining: limit,
      retryAfterSeconds: 0,
    };
  }
}
