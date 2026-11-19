import "server-only";
import { prisma } from "@/lib/db/prisma";
import { getWeeklyAggregates } from "./aggregate";
import { runMitigationChain } from "./chain";
import { groundPlan } from "./ground";
import { GroundedMitigationPlan } from "./schema";
import { WeeklyAggregates } from "./types";
import { Prisma } from "@prisma/client";
import { getAsOf } from "@/lib/asOf";

export interface GeneratePlanResult {
  status: "ok" | "no_data" | "degraded";
  plan?: GroundedMitigationPlan;
  aggregates?: WeeklyAggregates;
  asOf?: string;
  generatedAt: string;
  cached: boolean;
  stale?: boolean;
  includesSynthetic: boolean;
  model: string;
  servedModel?: string;
  unresolvedCount?: number;
  dataQualityNotes?: string[];
  error?: string;
}

export const CACHE_TTL_MS = 60 * 60 * 1000; // 60 minutes

export async function generateWeeklyPlan(options?: { force?: boolean }): Promise<GeneratePlanResult> {
  const now = new Date();
  const asOf = await getAsOf();

  // 1. Check cache unless force is requested
  if (!options?.force) {
    const latest = await prisma.mitigationPlan.findFirst({
      orderBy: { createdAt: "desc" },
    });

    if (latest && now.getTime() - latest.createdAt.getTime() < CACHE_TTL_MS) {
      const aggregates = latest.aggregatesJson as unknown as WeeklyAggregates;
      const planJsonObj = latest.planJson as unknown as Record<string, unknown>;
      const servedModel = typeof planJsonObj?.servedModel === "string" ? planJsonObj.servedModel : undefined;
      const unresolvedCount = aggregates?.rows
        ? aggregates.rows.filter((r) => r.wardKey === "UNRESOLVED").reduce((sum, r) => sum + r.current7, 0)
        : 0;

      return {
        status: "ok",
        plan: latest.planJson as unknown as GroundedMitigationPlan,
        aggregates,
        asOf: aggregates?.asOf ?? asOf.toISOString(),
        generatedAt: latest.createdAt.toISOString(),
        cached: true,
        includesSynthetic: latest.includesSynthetic,
        model: latest.model,
        servedModel,
        unresolvedCount,
        dataQualityNotes: unresolvedCount > 0
          ? [`${unresolvedCount} reports in the last 7 days could not be matched to a ward.`]
          : [],
      };
    }
  }

  // 2. Compute weekly aggregates using getAsOf() for windows
  // live reports with isSynthetic = false and createdAt after asOf fall outside these windows by design.
  const aggregates = await getWeeklyAggregates(asOf);
  if (aggregates.totals.current7 === 0 || aggregates.rows.length === 0) {
    return {
      status: "no_data",
      aggregates,
      asOf: asOf.toISOString(),
      generatedAt: now.toISOString(),
      cached: false,
      includesSynthetic: aggregates.totals.synthetic7 > 0,
      model: "none",
    };
  }

  // 3. Run LLM Chain & Ground
  try {
    const { plan: rawPlan, modelUsed, servedModel } = await runMitigationChain(aggregates);
    const grounded = groundPlan(rawPlan, aggregates);

    const recordedModel =
      modelUsed === "openrouter/free" && servedModel && servedModel !== modelUsed
        ? `${modelUsed} (served by ${servedModel})`
        : (servedModel || modelUsed);

    const unresolvedCount = aggregates.rows
      .filter((r) => r.wardKey === "UNRESOLVED")
      .reduce((sum, r) => sum + r.current7, 0);

    const dataQualityNotes =
      unresolvedCount > 0
        ? [`${unresolvedCount} reports in the last 7 days could not be matched to a ward.`]
        : [];

    const planJsonPayload = {
      ...grounded,
      servedModel,
      unresolvedCount,
      dataQualityNotes,
    };

    // 4. Save to DB
    const saved = await prisma.mitigationPlan.create({
      data: {
        windowStart: new Date(aggregates.windowStart),
        windowEnd: new Date(aggregates.windowEnd),
        model: recordedModel,
        includesSynthetic: aggregates.totals.synthetic7 > 0,
        aggregatesJson: aggregates as unknown as Prisma.InputJsonValue,
        planJson: planJsonPayload as unknown as Prisma.InputJsonValue,
      },
    });

    return {
      status: "ok",
      plan: grounded,
      aggregates,
      asOf: asOf.toISOString(),
      generatedAt: saved.createdAt.toISOString(),
      cached: false,
      includesSynthetic: saved.includesSynthetic,
      model: recordedModel,
      servedModel,
      unresolvedCount,
      dataQualityNotes,
    };
  } catch (err: unknown) {
    console.error("Error generating mitigation plan:", err);
    return {
      status: "degraded",
      aggregates,
      asOf: asOf.toISOString(),
      generatedAt: now.toISOString(),
      cached: false,
      includesSynthetic: aggregates.totals.synthetic7 > 0,
      model: "error",
      error: err instanceof Error ? err.message : "Failed to generate mitigation plan",
    };
  }
}

export async function getFreshCachedPlan(ttlMs: number = CACHE_TTL_MS): Promise<GeneratePlanResult | null> {
  const latest = await prisma.mitigationPlan.findFirst({
    orderBy: { createdAt: "desc" },
  });

  if (!latest) {
    return null;
  }

  const now = new Date();
  if (now.getTime() - latest.createdAt.getTime() < ttlMs) {
    const aggregates = latest.aggregatesJson as unknown as WeeklyAggregates;
    const planJsonObj = latest.planJson as unknown as Record<string, unknown>;
    const servedModel = typeof planJsonObj?.servedModel === "string" ? planJsonObj.servedModel : undefined;
    const unresolvedCount = aggregates?.rows
      ? aggregates.rows.filter((r) => r.wardKey === "UNRESOLVED").reduce((sum, r) => sum + r.current7, 0)
      : 0;

    return {
      status: "ok",
      plan: latest.planJson as unknown as GroundedMitigationPlan,
      aggregates,
      asOf: aggregates?.asOf,
      generatedAt: latest.createdAt.toISOString(),
      cached: true,
      includesSynthetic: latest.includesSynthetic,
      model: latest.model,
      servedModel,
      unresolvedCount,
      dataQualityNotes:
        unresolvedCount > 0
          ? [`${unresolvedCount} reports in the last 7 days could not be matched to a ward.`]
          : [],
    };
  }

  return null;
}

export async function getLatestCachedPlan(options?: { stale?: boolean }): Promise<GeneratePlanResult> {
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

  const aggregates = latest.aggregatesJson as unknown as WeeklyAggregates;
  const planJsonObj = latest.planJson as unknown as Record<string, unknown>;
  const servedModel = typeof planJsonObj?.servedModel === "string" ? planJsonObj.servedModel : undefined;
  const unresolvedCount = aggregates?.rows
    ? aggregates.rows.filter((r) => r.wardKey === "UNRESOLVED").reduce((sum, r) => sum + r.current7, 0)
    : 0;

  return {
    status: "ok",
    plan: latest.planJson as unknown as GroundedMitigationPlan,
    aggregates,
    asOf: aggregates?.asOf,
    generatedAt: latest.createdAt.toISOString(),
    cached: true,
    ...(options?.stale ? { stale: true } : {}),
    includesSynthetic: latest.includesSynthetic,
    model: latest.model,
    servedModel,
    unresolvedCount,
    dataQualityNotes:
      unresolvedCount > 0
        ? [`${unresolvedCount} reports in the last 7 days could not be matched to a ward.`]
        : [],
  };
}
