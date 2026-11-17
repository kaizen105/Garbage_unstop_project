import { describe, it, expect, vi } from "vitest";
import { ALL_HAZARD_CATEGORIES, CATEGORY_COLORS, getCategoryLabel } from "@/lib/categories";
import { getLatestCachedPlan } from "@/lib/mitigation/service";
import { prisma } from "@/lib/db/prisma";

vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    mitigationPlan: {
      findFirst: vi.fn(),
    },
  },
}));

describe("Category and Legend Mapping", () => {
  it("covers every single HazardCategory in CATEGORY_COLORS without extra keys", () => {
    const keys = Object.keys(CATEGORY_COLORS);
    expect(keys.sort()).toEqual([...ALL_HAZARD_CATEGORIES].sort());
    expect(keys).not.toContain("dead_animal");
  });

  it("labels unknown as Unclassified and humanizes other categories", () => {
    expect(getCategoryLabel("unknown")).toBe("Unclassified");
    expect(getCategoryLabel("biohazard_medical")).toBe("Biohazard medical");
    expect(getCategoryLabel("electrical_hazard")).toBe("Electrical hazard");
  });
});

describe("getLatestCachedPlan Unit Test", () => {
  it("returns none/no_data when MitigationPlan table is empty without LLM calls", async () => {
    vi.mocked(prisma.mitigationPlan.findFirst).mockResolvedValueOnce(null);

    const res = await getLatestCachedPlan();
    expect(res.status).toBe("no_data");
    expect(res.plan).toBeUndefined();
    expect(res.cached).toBe(true);
    expect(res.model).toBe("none");
  });

  it("returns the newest cached plan row when one exists", async () => {
    const mockRow = {
      id: "plan-123",
      windowStart: new Date("2026-11-09T00:00:00Z"),
      windowEnd: new Date("2026-11-16T00:00:00Z"),
      model: "openrouter/free",
      includesSynthetic: true,
      aggregatesJson: { totals: { current7: 15, previous7: 5 } },
      planJson: {
        headline: "Cached Operational Strategy",
        priorities: [],
        crossCuttingActions: [],
      },
      createdAt: new Date("2026-11-16T12:00:00Z"),
    };

    vi.mocked(prisma.mitigationPlan.findFirst).mockResolvedValueOnce(mockRow as never);

    const res = await getLatestCachedPlan();
    expect(res.status).toBe("ok");
    expect(res.plan?.headline).toBe("Cached Operational Strategy");
    expect(res.cached).toBe(true);
    expect(res.model).toBe("openrouter/free");
    expect(res.includesSynthetic).toBe(true);
  });
});
