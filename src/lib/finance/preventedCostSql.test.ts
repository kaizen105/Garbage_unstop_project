import { describe, it, expect } from "vitest";
import {
  buildPreventedCostSqlString,
  buildPreventedCostSql,
  getValidatedCostConstants,
} from "./preventedCostSql";
import { AVOIDED_INCIDENT_COST_INR } from "./assumptions";
import { estimateImpact } from "./impact";

/**
 * Offline evaluation helper that computes the value that the generated
 * SQL fragment would yield for a given report row.
 */
function evaluatePreventedCostSql(
  sql: string,
  report: { action_required: string; hazard_category: string; severity_level: number }
): number {
  if (report.action_required === "routine_collection") {
    expect(sql).toContain('WHEN "actionRequired" <> \'routine_collection\' THEN');
    expect(sql).toContain("ELSE 0");
    return 0;
  }

  const catRegex = new RegExp(
    `WHEN\\s+'${report.hazard_category}'\\s+THEN\\s+(\\d+)\\s*\\*\\s*\\("severityLevel"::float8\\s*\\/\\s*(\\d+)\\.0\\)`
  );
  const match = sql.match(catRegex);
  let baseCost: number;
  let divisor: number;

  if (match) {
    baseCost = Number(match[1]);
    divisor = Number(match[2]);
  } else {
    const elseRegex = /ELSE\s+(\d+)\s*\*\s*\("severityLevel"::float8\s*\/\s*(\d+)\.0\)/;
    const elseMatch = sql.match(elseRegex);
    if (!elseMatch) throw new Error("Could not find ELSE fallback clause in SQL fragment");
    baseCost = Number(elseMatch[1]);
    divisor = Number(elseMatch[2]);
  }

  return baseCost * (report.severity_level / divisor);
}

describe("preventedCostSql Unit Tests", () => {
  const sqlString = buildPreventedCostSqlString();
  const testSeverities = [1, 5, 10];
  const allCategories = [...Object.keys(AVOIDED_INCIDENT_COST_INR), "unregistered_hazard"];

  it("builds a valid Prisma.Sql fragment", () => {
    const prismaSql = buildPreventedCostSql();
    expect(prismaSql.text).toBe(sqlString);
    expect(prismaSql.values).toEqual([]);
  });

  describe.each(allCategories)("category: %s", (category) => {
    it.each(testSeverities)(
      "matches estimateImpact.prevented_inr for non-routine action at severity %i",
      (severity) => {
        const sqlVal = evaluatePreventedCostSql(sqlString, {
          action_required: "dispatch_hazmat_bypass_standard",
          hazard_category: category,
          severity_level: severity,
        });

        const expected = estimateImpact({
          action_required: "dispatch_hazmat_bypass_standard",
          hazard_category: category,
          severity_level: severity,
        }).prevented_inr;

        expect(sqlVal).toBe(expected);
      }
    );

    it.each(testSeverities)(
      "yields 0 for routine_collection at severity %i",
      (severity) => {
        const sqlVal = evaluatePreventedCostSql(sqlString, {
          action_required: "routine_collection",
          hazard_category: category,
          severity_level: severity,
        });

        const expected = estimateImpact({
          action_required: "routine_collection",
          hazard_category: category,
          severity_level: severity,
        }).prevented_inr;

        expect(sqlVal).toBe(0);
        expect(expected).toBe(0);
      }
    );
  });

  it("validates that all constants are finite numbers", () => {
    const validated = getValidatedCostConstants();
    expect(validated.severityDivisor).toBe(10);
    expect(Object.keys(validated.costs).length).toBe(Object.keys(AVOIDED_INCIDENT_COST_INR).length);
    for (const cost of Object.values(validated.costs)) {
      expect(Number.isFinite(cost)).toBe(true);
      expect(cost).toBeGreaterThanOrEqual(0);
    }
  });
});
