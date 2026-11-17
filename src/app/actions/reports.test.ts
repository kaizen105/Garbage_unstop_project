import { describe, it, expect } from "vitest";
import { buildDemoResetDeleteWhere } from "@/app/actions/reports";

describe("buildDemoResetDeleteWhere Unit Test", () => {
  it("targets only synthetic reports with id starting with HZ-", () => {
    const where = buildDemoResetDeleteWhere();
    expect(where).toEqual({
      isSynthetic: true,
      id: {
        startsWith: "HZ-",
      },
    });
  });

  it("does not match reports starting with SYN- or real non-synthetic reports", () => {
    const where = buildDemoResetDeleteWhere();
    expect(where.isSynthetic).toBe(true);
    expect(where.id.startsWith).toBe("HZ-");
    expect(where.id.startsWith).not.toBe("SYN-");
  });
});
