import { NextResponse } from "next/server";
import {
  generateWeeklyPlan,
  getFreshCachedPlan,
  getLatestCachedPlan,
} from "@/lib/mitigation/service";
import { checkRateLimit, extractClientIp } from "@/lib/rateLimit";
import { getEnv } from "@/lib/env";
import {
  tryAcquireMitigationLock,
  releaseMitigationLock,
} from "@/lib/mitigation/lock";

export async function POST(request: Request) {
  try {
    let force = false;
    try {
      const body = await request.json();
      if (body && typeof body.force === "boolean") {
        force = body.force;
      }
    } catch {
      // Empty or non-JSON body is valid, defaults to force: false
    }

    // 1. Fast path for fresh cache hits (unlimited and fast; does not consume quota or lock)
    if (!force) {
      const freshPlan = await getFreshCachedPlan();
      if (freshPlan) {
        return NextResponse.json(freshPlan);
      }
    }

    const env = getEnv();

    // 2. Global generation cap (e.g. 20 generations per hour across all callers)
    // Note: checkRateLimit explicitly fails open on database errors.
    const globalLimit = await checkRateLimit("mitigation:global", {
      limit: env.RATE_LIMIT_MITIGATION_GLOBAL_MAX,
      windowSeconds: 3600,
    });

    if (!globalLimit.allowed) {
      const latestCached = await getLatestCachedPlan({ stale: true });
      if (latestCached.status === "ok" && latestCached.plan) {
        return NextResponse.json(latestCached);
      }
      return NextResponse.json(
        {
          error: "RATE_LIMITED",
          message: `Global mitigation plan generation limit reached. Please wait ${globalLimit.retryAfterSeconds} seconds.`,
          retryAfter: globalLimit.retryAfterSeconds,
        },
        {
          status: 429,
          headers: {
            "Retry-After": globalLimit.retryAfterSeconds.toString(),
          },
        }
      );
    }

    // 3. Per-IP rate limit (e.g. 5 generations per 10 minutes per IP)
    const clientIp = extractClientIp(request.headers);
    const ipLimit = await checkRateLimit("mitigation:" + clientIp, {
      limit: env.RATE_LIMIT_MITIGATION_PER_IP_MAX,
      windowSeconds: 600,
    });

    if (!ipLimit.allowed) {
      return NextResponse.json(
        {
          error: "RATE_LIMITED",
          message: `Rate limit exceeded. Please wait ${ipLimit.retryAfterSeconds} seconds before requesting another mitigation plan.`,
          retryAfter: ipLimit.retryAfterSeconds,
        },
        {
          status: 429,
          headers: {
            "Retry-After": ipLimit.retryAfterSeconds.toString(),
          },
        }
      );
    }

    // 4. Single-flight concurrency lock to prevent thundering herd on expired cache
    // Note: tryAcquireMitigationLock explicitly fails open on unexpected database errors.
    const lockAcquired = await tryAcquireMitigationLock();
    if (!lockAcquired) {
      const latestCached = await getLatestCachedPlan({ stale: true });
      if (latestCached.status === "ok" && latestCached.plan) {
        return NextResponse.json(latestCached);
      }
      return NextResponse.json({ status: "GENERATING" }, { status: 202 });
    }

    // 5. Plan generation with guaranteed lock release in finally
    try {
      const result = await generateWeeklyPlan({ force: true });
      return NextResponse.json(result);
    } finally {
      await releaseMitigationLock();
    }
  } catch (error: unknown) {
    console.error("POST /api/mitigation-plan error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

export async function GET() {
  try {
    const result = await getLatestCachedPlan();
    return NextResponse.json(result);
  } catch (error: unknown) {
    console.error("GET /api/mitigation-plan error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
