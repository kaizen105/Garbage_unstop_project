import { describe, it, expect } from "vitest";
import { getWeeklyAggregates } from "./aggregate";
import { prisma } from "@/lib/db/prisma";

describe("Weekly Aggregates Integration Test", () => {
  it("computes SQL aggregates matching database counts", async () => {
    const now = new Date();
    const windowStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    const aggregates = await getWeeklyAggregates(now);

    const totalCount = await prisma.report.count({
      where: {
        createdAt: {
          gte: windowStart,
          lt: now,
        },
      },
    });

    expect(aggregates.totals.current7).toBe(totalCount);

    const rowSum = aggregates.rows.reduce((sum, r) => sum + r.current7, 0);
    expect(rowSum).toBe(totalCount);

    for (const row of aggregates.rows) {
      expect(row.current7).toBeGreaterThan(0);
      expect(typeof row.avgSeverity).toBe("number");
      expect(row.avgSeverity).toBeGreaterThanOrEqual(1);
      expect(row.avgSeverity).toBeLessThanOrEqual(10);
      expect(row.maxSeverity).toBeGreaterThanOrEqual(row.avgSeverity - 1);
    }
  });
});
