import { describe, it, expect } from "vitest";
import { getDispatchBadge } from "./dispatch";

describe("getDispatchBadge Unit Tests", () => {
  it("maps dispatch_hazmat_bypass_standard to danger tone", () => {
    const res = getDispatchBadge("dispatch_hazmat_bypass_standard");
    expect(res).toEqual({ label: "HAZMAT + BYPASS", tone: "danger" });
  });

  it("maps bypass_standard to warning tone", () => {
    const res = getDispatchBadge("bypass_standard");
    expect(res).toEqual({ label: "BYPASS STANDARD", tone: "warning" });
  });

  it("maps routine_collection to neutral tone", () => {
    const res = getDispatchBadge("routine_collection");
    expect(res).toEqual({ label: "ROUTINE", tone: "neutral" });
  });

  it("maps unknown values to neutral tone and UNKNOWN label", () => {
    const res = getDispatchBadge("unexpected_future_action");
    expect(res).toEqual({ label: "UNKNOWN", tone: "neutral" });
  });
});
