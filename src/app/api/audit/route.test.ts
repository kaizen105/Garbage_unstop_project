import { describe, it, expect, vi } from "vitest";
import { POST } from "./route";

vi.mock("next/server", async () => {
  const actual = await vi.importActual<typeof import("next/server")>("next/server");
  return {
    ...actual,
    connection: vi.fn().mockResolvedValue(undefined),
  };
});

vi.mock("@/lib/audit/audit", () => ({
  runAudit: vi.fn().mockResolvedValue({ status: "success" }),
  runAuditFromCluster: vi.fn().mockResolvedValue({ status: "success" }),
}));

vi.mock("@/lib/audit/dbAnomaly", () => ({
  findLargestAnomalyFromDb: vi.fn().mockResolvedValue(null),
}));

vi.mock("@/lib/asOf", () => ({
  getAsOf: vi.fn().mockResolvedValue(new Date("2026-11-17T00:00:00.000Z")),
  computeWindowEnd: vi.fn((asOf: Date) => new Date(asOf.getTime() + 1000)),
}));

describe("POST /api/audit input validation", () => {
  it("rejects malformed non-empty JSON with HTTP 400", async () => {
    const req = new Request("http://localhost/api/audit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{\ninvalid json",
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toEqual({
      error: "VALIDATION_ERROR",
      message: "Invalid payload",
    });
  });

  it("rejects payload with out-of-bounds coordinates (ZodError) with HTTP 400", async () => {
    const req = new Request("http://localhost/api/audit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        reports: [
          {
            hazard_category: "chemical",
            createdAt: "2026-01-01T00:00:00.000Z",
            lat: 999, // out of range -90..90
            lng: 77.1,
          },
        ],
      }),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toEqual({
      error: "VALIDATION_ERROR",
      message: "Invalid payload",
    });
  });

  it("rejects payload exceeding 500 reports with HTTP 400", async () => {
    const reports = Array.from({ length: 501 }, () => ({
      hazard_category: "chemical",
      createdAt: "2026-01-01T00:00:00.000Z",
    }));
    const req = new Request("http://localhost/api/audit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reports }),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toEqual({
      error: "VALIDATION_ERROR",
      message: "Invalid payload",
    });
  });

  it("accepts empty JSON body ({}) and processes bounded cluster audit with HTTP 200", async () => {
    const req = new Request("http://localhost/api/audit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ status: "success" });
  });

  it("accepts empty body without text and returns HTTP 200", async () => {
    const req = new Request("http://localhost/api/audit", {
      method: "POST",
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ status: "success" });
  });
});
