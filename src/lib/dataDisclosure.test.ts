import { describe, it, expect } from "vitest";
import { DATA_DISCLOSURE_TEXT } from "./dataDisclosure";

describe("DATA_DISCLOSURE_TEXT", () => {
  it("contains all required disclosure terms", () => {
    expect(DATA_DISCLOSURE_TEXT).toContain("Synthetic");
    expect(DATA_DISCLOSURE_TEXT).toContain("Bengaluru");
    expect(DATA_DISCLOSURE_TEXT).toContain("Delhi MCD ward boundaries");
    expect(DATA_DISCLOSURE_TEXT).toContain("not real");
  });
});
