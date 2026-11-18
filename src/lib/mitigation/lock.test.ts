import { describe, it, expect, vi, beforeEach } from "vitest";
import { tryAcquireMitigationLock, releaseMitigationLock } from "./lock";
import { prisma } from "@/lib/db/prisma";
import { Prisma } from "@prisma/client";

vi.mock("@/lib/db/prisma", () => ({
  prisma: {
    rateLimit: {
      deleteMany: vi.fn(),
      create: vi.fn(),
    },
  },
}));

describe("Mitigation lock unit tests", () => {
  const mockDeleteMany = vi.mocked(prisma.rateLimit.deleteMany);
  const mockCreate = vi.mocked(prisma.rateLimit.create);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("acquires lock successfully when no unexpired lock exists", async () => {
    mockDeleteMany.mockResolvedValueOnce({ count: 0 });
    mockCreate.mockResolvedValueOnce({
      id: "test-lock-id",
      key: "lock:mitigation",
      count: 1,
      windowStart: new Date(0),
      updatedAt: new Date(),
    });

    const acquired = await tryAcquireMitigationLock("lock:mitigation", 60000);
    expect(acquired).toBe(true);

    expect(mockDeleteMany).toHaveBeenCalledTimes(1);
    expect(mockCreate).toHaveBeenCalledTimes(1);
  });

  it("returns false when lock creation encounters P2002 unique constraint conflict", async () => {
    mockDeleteMany.mockResolvedValueOnce({ count: 0 });
    const p2002Error = new Prisma.PrismaClientKnownRequestError(
      "Unique constraint failed",
      {
        code: "P2002",
        clientVersion: "5.0.0",
      }
    );
    mockCreate.mockRejectedValueOnce(p2002Error);

    const acquired = await tryAcquireMitigationLock("lock:mitigation", 60000);
    expect(acquired).toBe(false);
  });

  it("fails open and returns true when database throws unexpected error", async () => {
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockDeleteMany.mockResolvedValueOnce({ count: 0 });
    mockCreate.mockRejectedValueOnce(new Error("Connection terminated"));

    const acquired = await tryAcquireMitigationLock("lock:mitigation", 60000);
    expect(acquired).toBe(true);

    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });

  it("releases lock by deleting the lock row", async () => {
    mockDeleteMany.mockResolvedValueOnce({ count: 1 });

    await releaseMitigationLock("lock:mitigation");
    expect(mockDeleteMany).toHaveBeenCalledWith({
      where: { key: "lock:mitigation" },
    });
  });
});
