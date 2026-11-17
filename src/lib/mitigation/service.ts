import "server-only";
import { prisma } from "@/lib/db/prisma";
import { getWeeklyAggregates } from "./aggregate";
import { runMitigationChain } from "./chain";
import { groundPlan } from "./ground";
import { GroundedMitigationPlan } from "./schema";
import { WeeklyAggregates } from "./types";
import { Prisma } from "@prisma/client";

export interface GeneratePlanResult {
  status: "ok" | "no_data" | "degraded";
  plan?: GroundedMitigationPlan;
  aggregates?: WeeklyAggregates;
  generatedAt: string;
  cached: boolean;
  includesSynthetic: boolean;
  model: string;
  error?: string;
}

const CACHE_TTL_MS = 60 * 60 * 1000; // 60 minutes

export async function generateWeeklyPlan(options?: { force?: boolean }): Promise<GeneratePlanResult> {
  const now = new Date();

  // 1. Check cache unless force is requested
  if (!options?.force) {
    const latest = await prisma.mitigationPlan.findFirst({
      orderBy: { createdAt: "desc" },
    });

    if (latest && now.getTime() - latest.createdAt.getTime() < CACHE_TTL_MS) {
      return {
        status: "ok",
        plan: latest.planJson as unknown as GroundedMitigationPlan,
        aggregates: latest.aggregatesJson as unknown as WeeklyAggregates,
        generatedAt: latest.createdAt.toISOString(),
        cached: true,
        includesSynthetic: latest.includesSynthetic,
        model: latest.model,
      };
    }
  }

  // 2. Compute weekly aggregates
  const aggregates = await getWeeklyAggregates(now);
  if (aggregates.totals.current7 === 0 || aggregates.rows.length === 0) {
    return {
      status: "no_data",
      aggregates,
      generatedAt: now.toISOString(),
      cached: false,
      includesSynthetic: aggregates.totals.synthetic7 > 0,
      model: "none",
    };
  }

  // 3. Run LLM Chain & Ground
  try {
    const { plan: rawPlan, modelUsed } = await runMitigationChain(aggregates);
    const grounded = groundPlan(rawPlan, aggregates);

    // 4. Save to DB
    const saved = await prisma.mitigationPlan.create({
      data: {
        windowStart: new Date(aggregates.windowStart),
        windowEnd: new Date(aggregates.windowEnd),
        model: modelUsed,
        includesSynthetic: aggregates.totals.synthetic7 > 0,
        aggregatesJson: aggregates as unknown as Prisma.InputJsonValue,
        planJson: grounded as unknown as Prisma.InputJsonValue,
      },
    });

    return {
      status: "ok",
      plan: grounded,
      aggregates,
      generatedAt: saved.createdAt.toISOString(),
      cached: false,
      includesSynthetic: saved.includesSynthetic,
      model: modelUsed,
    };
  } catch (err: unknown) {
    console.error("Error generating mitigation plan:", err);
    return {
      status: "degraded",
      aggregates,
      generatedAt: now.toISOString(),
      cached: false,
      includesSynthetic: aggregates.totals.synthetic7 > 0,
      model: "error",
      error: err instanceof Error ? err.message : "Failed to generate mitigation plan",
    };
  }
}


export async function getLatestCachedPlan(): Promise<GeneratePlanResult> {
  const latest = await prisma.mitigationPlan.findFirst({
    orderBy: { createdAt: "desc" },
  });

  if (!latest) {
    return {
      status: "no_data",
      generatedAt: new Date().toISOString(),
      cached: true,
      includesSynthetic: false,
      model: "none",
    };
  }

  return {
    status: "ok",
    plan: latest.planJson as unknown as GroundedMitigationPlan,
    aggregates: latest.aggregatesJson as unknown as WeeklyAggregates,
    generatedAt: latest.createdAt.toISOString(),
    cached: true,
    includesSynthetic: latest.includesSynthetic,
    model: latest.model,
  };
}
