import { Prisma } from "@prisma/client";
import { AVOIDED_INCIDENT_COST_INR, SEVERITY_DIVISOR } from "./assumptions";

/**
 * Validates that all cost constants and divisors are finite non-negative numbers.
 * Throws an error if any constant is invalid.
 */
export function getValidatedCostConstants(): {
  costs: Record<string, number>;
  fallbackCost: number;
  severityDivisor: number;
} {
  if (!Number.isFinite(SEVERITY_DIVISOR) || SEVERITY_DIVISOR <= 0) {
    throw new Error(`Invalid SEVERITY_DIVISOR: ${SEVERITY_DIVISOR}`);
  }

  const costs: Record<string, number> = {};
  for (const [category, cost] of Object.entries(AVOIDED_INCIDENT_COST_INR)) {
    if (!Number.isFinite(cost) || cost < 0) {
      throw new Error(`Invalid cost constant for category ${category}: ${cost}`);
    }
    costs[category] = cost;
  }

  const fallbackCost = costs["unknown"];
  if (fallbackCost === undefined || !Number.isFinite(fallbackCost) || fallbackCost < 0) {
    throw new Error("Missing or invalid 'unknown' fallback cost in AVOIDED_INCIDENT_COST_INR");
  }

  return { costs, fallbackCost, severityDivisor: SEVERITY_DIVISOR };
}

/**
 * Builds the raw SQL CASE expression string for estimating prevented cost.
 * Only validated numeric constants from assumptions.ts are interpolated.
 */
export function buildPreventedCostSqlString(): string {
  const { costs, fallbackCost, severityDivisor } = getValidatedCostConstants();

  const whenClauses = Object.entries(costs)
    .filter(([category]) => category !== "unknown")
    .map(
      ([category, cost]) =>
        `WHEN '${category}' THEN ${cost} * ("severityLevel"::float8 / ${severityDivisor}.0)`
    )
    .join("\n                ");

  return `CASE
            WHEN "actionRequired" <> 'routine_collection' THEN
              CASE "hazardCategory"
                ${whenClauses}
                ELSE ${fallbackCost} * ("severityLevel"::float8 / ${severityDivisor}.0)
              END
            ELSE 0
          END`;
}

/**
 * Returns a trusted Prisma SQL fragment representing the CASE expression for prevented cost.
 */
export function buildPreventedCostSql(): Prisma.Sql {
  return Prisma.raw(buildPreventedCostSqlString());
}
