import { RawMitigationPlan, GroundedMitigationPlan } from "./schema";
import { WeeklyAggregates, WardCategoryAggregate } from "./types";

export class GroundingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GroundingError";
  }
}

export function groundPlan(
  rawPlan: RawMitigationPlan,
  aggregates: WeeklyAggregates
): GroundedMitigationPlan {
  // Map row keys for fast lookup: `${wardKey}::${category}`
  const lookup = new Map<string, WardCategoryAggregate>();
  for (const row of aggregates.rows) {
    lookup.set(`${row.wardKey}::${row.category}`, row);
  }

  const seenKeys = new Set<string>();
  const groundedPriorities = [];

  for (const p of rawPlan.priorities) {
    if (p.wardKey === "UNRESOLVED") {
      throw new GroundingError("UNRESOLVED cannot be selected as a targeted priority intervention.");
    }

    const key = `${p.wardKey}::${p.category}`;
    if (seenKeys.has(key)) {
      throw new GroundingError(`Duplicate priority key in plan: ${key}`);
    }
    seenKeys.add(key);

    const agg = lookup.get(key);
    if (!agg) {
      throw new GroundingError(
        `Priority for wardKey '${p.wardKey}' and category '${p.category}' does not exist in weekly aggregates.`
      );
    }

    groundedPriorities.push({
      ...p,
      wardName: agg.wardName,
      current7: agg.current7,
      previous7: agg.previous7,
      delta: agg.delta,
      avgSeverity: agg.avgSeverity,
      maxSeverity: agg.maxSeverity,
    });
  }

  return {
    headline: rawPlan.headline,
    priorities: groundedPriorities,
    crossCuttingActions: rawPlan.crossCuttingActions || [],
  };
}
