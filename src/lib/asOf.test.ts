import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { getAsOf, computeWindowEnd } from "./asOf";
import { prisma } from "@/lib/db/prisma";
import { weeklyBuckets } from "@/lib/early-warning/trends";
import type { Report } from "@/lib/store/reports";

vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    report: {
      aggregate: vi.fn(),
    },
  },
}));

describe("getAsOf", () => {
  const mockAggregate = vi.mocked(prisma.report.aggregate);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns the mocked max date when synthetic reports exist", async () => {
    const fixedMaxDate = new Date("2026-11-17T15:30:00.000Z");
    mockAggregate.mockResolvedValueOnce({
      _max: { createdAt: fixedMaxDate },
      _min: { createdAt: null },
      _count: { createdAt: 100 },
    } as unknown as Awaited<ReturnType<typeof prisma.report.aggregate>>);

    const asOf = await getAsOf();
    expect(asOf).toEqual(fixedMaxDate);
    expect(mockAggregate).toHaveBeenCalledWith({
      where: { isSynthetic: true },
      _max: { createdAt: true },
    });
  });

  it("falls back to now when max date is empty (no synthetic reports)", async () => {
    mockAggregate.mockResolvedValueOnce({
      _max: { createdAt: null },
      _min: { createdAt: null },
      _count: { createdAt: 0 },
    } as unknown as Awaited<ReturnType<typeof prisma.report.aggregate>>);

    const before = Date.now();
    const asOf = await getAsOf();
    const after = Date.now();

    expect(asOf.getTime()).toBeGreaterThanOrEqual(before);
    expect(asOf.getTime()).toBeLessThanOrEqual(after);
  });

  it("falls back to now and logs error when query throws", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockAggregate.mockRejectedValueOnce(new Error("Connection failure"));

    const before = Date.now();
    const asOf = await getAsOf();
    const after = Date.now();

    expect(asOf.getTime()).toBeGreaterThanOrEqual(before);
    expect(asOf.getTime()).toBeLessThanOrEqual(after);
    expect(consoleSpy).toHaveBeenCalled();

    consoleSpy.mockRestore();
  });

  it("produces identical window end and bucket counts when timers are advanced 60 days after data", () => {
    const fixedAsOf = new Date("2026-11-17T00:00:00.000Z");
    const sampleReports: Report[] = [
      {
        report_id: "r1",
        transcript: "W0 report",
        hazard_category: "chemical",
        severity_level: 5,
        raw_location: "Ward A",
        action_required: "routine_collection",
        coordinates: { lat: 28.6, lng: 77.2 },
        createdAt: new Date(fixedAsOf.getTime() - 2 * 24 * 60 * 60 * 1000).toISOString(),
      },
      {
        report_id: "r2",
        transcript: "W1 report",
        hazard_category: "chemical",
        severity_level: 5,
        raw_location: "Ward A",
        action_required: "routine_collection",
        coordinates: { lat: 28.6, lng: 77.2 },
        createdAt: new Date(fixedAsOf.getTime() - 9 * 24 * 60 * 60 * 1000).toISOString(),
      },
      {
        report_id: "r3",
        transcript: "W2 report",
        hazard_category: "chemical",
        severity_level: 5,
        raw_location: "Ward A",
        action_required: "routine_collection",
        coordinates: { lat: 28.6, lng: 77.2 },
        createdAt: new Date(fixedAsOf.getTime() - 16 * 24 * 60 * 60 * 1000).toISOString(),
      },
      {
        report_id: "r4",
        transcript: "W3 report",
        hazard_category: "chemical",
        severity_level: 5,
        raw_location: "Ward A",
        action_required: "routine_collection",
        coordinates: { lat: 28.6, lng: 77.2 },
        createdAt: new Date(fixedAsOf.getTime() - 23 * 24 * 60 * 60 * 1000).toISOString(),
      },
    ];

    // Case 1: Timer at fixed asOf
    vi.useFakeTimers();
    vi.setSystemTime(fixedAsOf);
    const endAtAsOf = computeWindowEnd(fixedAsOf);
    const w0StartAtAsOf = new Date(endAtAsOf.getTime() - 7 * 24 * 60 * 60 * 1000);
    const w1StartAtAsOf = new Date(endAtAsOf.getTime() - 14 * 24 * 60 * 60 * 1000);
    const bucketsAtAsOf = weeklyBuckets(sampleReports, fixedAsOf.getTime());

    // Case 2: Timer 60 days in the future
    const sixtyDaysLater = new Date(fixedAsOf.getTime() + 60 * 24 * 60 * 60 * 1000);
    vi.setSystemTime(sixtyDaysLater);
    const endSixtyDaysLater = computeWindowEnd(fixedAsOf);
    const w0StartSixtyDaysLater = new Date(endSixtyDaysLater.getTime() - 7 * 24 * 60 * 60 * 1000);
    const w1StartSixtyDaysLater = new Date(endSixtyDaysLater.getTime() - 14 * 24 * 60 * 60 * 1000);
    const bucketsSixtyDaysLater = weeklyBuckets(sampleReports, fixedAsOf.getTime());

    // Window boundaries for fixed asOf are invariant to current system clock
    expect(endSixtyDaysLater.getTime()).toBe(endAtAsOf.getTime());
    expect(w0StartSixtyDaysLater.getTime()).toBe(w0StartAtAsOf.getTime());
    expect(w1StartSixtyDaysLater.getTime()).toBe(w1StartAtAsOf.getTime());
    expect(endSixtyDaysLater.getTime()).toBe(fixedAsOf.getTime() + 1000);

    // Bucket counts for fixed asOf are identical regardless of system clock
    expect(bucketsSixtyDaysLater["Ward A"]!.counts).toEqual(bucketsAtAsOf["Ward A"]!.counts);
    expect(bucketsSixtyDaysLater["Ward A"]!.counts).toEqual([1, 1, 1, 1]);
  });

  it("Early Warning, Mitigation and Audit windows use the exact same end value for the same asOf", () => {
    const asOf = new Date("2026-11-17T12:00:00.000Z");

    const earlyWarningEnd = computeWindowEnd(asOf);
    const mitigationEnd = computeWindowEnd(asOf);
    const auditEnd = computeWindowEnd(asOf);

    // Assert same end value
    expect(earlyWarningEnd.getTime()).toBe(asOf.getTime() + 1000);
    expect(mitigationEnd.getTime()).toBe(earlyWarningEnd.getTime());
    expect(auditEnd.getTime()).toBe(earlyWarningEnd.getTime());

    // Assert current 7-day window [end - 7d, end) matches exactly across all three modules
    const ONE_WEEK_MS = 7 * 24 * 60 * 60 * 1000;
    const earlyWarningW0 = { start: new Date(earlyWarningEnd.getTime() - ONE_WEEK_MS), end: earlyWarningEnd };
    const mitigationCurrent7 = { start: new Date(mitigationEnd.getTime() - ONE_WEEK_MS), end: mitigationEnd };
    const auditThisWeek = { start: new Date(auditEnd.getTime() - ONE_WEEK_MS), end: auditEnd };

    expect(earlyWarningW0.start.getTime()).toBe(mitigationCurrent7.start.getTime());
    expect(earlyWarningW0.end.getTime()).toBe(mitigationCurrent7.end.getTime());
    expect(auditThisWeek.start.getTime()).toBe(mitigationCurrent7.start.getTime());
    expect(auditThisWeek.end.getTime()).toBe(mitigationCurrent7.end.getTime());
  });
});
