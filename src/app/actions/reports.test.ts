import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { buildDemoResetDeleteWhere, resetSyntheticData } from "@/app/actions/reports";
import { prisma } from "@/lib/db/prisma";

vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    ward: {
      findMany: vi.fn(),
    },
    report: {
      deleteMany: vi.fn(),
      upsert: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

const mockWardFindMany = vi.mocked(prisma.ward.findMany);
const mockReportDeleteMany = vi.mocked(prisma.report.deleteMany);
const mockReportUpsert = vi.mocked(prisma.report.upsert);
const mockTransaction = vi.mocked(prisma.$transaction);

describe("buildDemoResetDeleteWhere Unit Test", () => {
  it("targets only synthetic reports with id starting with HZ-", async () => {
    const where = await buildDemoResetDeleteWhere();
    expect(where).toEqual({
      isSynthetic: true,
      id: {
        startsWith: "HZ-",
      },
    });
  });

  it("does not match reports starting with SYN- or real non-synthetic reports", async () => {
    const where = await buildDemoResetDeleteWhere();
    expect(where.isSynthetic).toBe(true);
    expect(where.id.startsWith).toBe("HZ-");
    expect(where.id.startsWith).not.toBe("SYN-");
  });
});

describe("resetSyntheticData Unit Tests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  const disabledCases = [
    { desc: "unset", value: undefined },
    { desc: '"false"', value: "false" },
    { desc: '"TRUE"', value: "TRUE" },
    { desc: '"1"', value: "1" },
    { desc: '""', value: "" },
  ];

  it.each(disabledCases)(
    "refuses reset when ENABLE_DEMO_RESET is $desc and calls no Prisma methods",
    async ({ value }) => {
      if (value === undefined) {
        vi.stubEnv("ENABLE_DEMO_RESET", undefined as unknown as string);
        delete process.env.ENABLE_DEMO_RESET;
      } else {
        vi.stubEnv("ENABLE_DEMO_RESET", value);
      }

      const result = await resetSyntheticData();

      expect(result).toEqual({
        ok: false,
        error: "Demo reset is disabled in this environment.",
      });
      expect(mockWardFindMany).not.toHaveBeenCalled();
      expect(mockTransaction).not.toHaveBeenCalled();
      expect(mockReportDeleteMany).not.toHaveBeenCalled();
      expect(mockReportUpsert).not.toHaveBeenCalled();
    }
  );

  it("allows execution past the guard to prisma.ward.findMany when ENABLE_DEMO_RESET is 'true'", async () => {
    vi.stubEnv("ENABLE_DEMO_RESET", "true");
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    mockWardFindMany.mockRejectedValueOnce(new Error("Stop early after findMany"));

    const result = await resetSyntheticData();

    expect(mockWardFindMany).toHaveBeenCalledTimes(1);
    expect(mockTransaction).not.toHaveBeenCalled();
    expect(mockReportDeleteMany).not.toHaveBeenCalled();
    expect(mockReportUpsert).not.toHaveBeenCalled();
    expect(result).toEqual({
      ok: false,
      error: "Failed to reset synthetic data.",
    });

    consoleSpy.mockRestore();
  });
});
