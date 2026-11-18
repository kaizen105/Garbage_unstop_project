import { describe, it, expect, vi } from "vitest";
import { GET } from "./route";

vi.mock("next/server", async () => {
  const actual = await vi.importActual<typeof import("next/server")>("next/server");
  return {
    ...actual,
    connection: vi.fn().mockResolvedValue(undefined),
  };
});

vi.mock("@/lib/reports/service", async () => {
  const actual = await vi.importActual<typeof import("@/lib/reports/service")>("@/lib/reports/service");
  return {
    ...actual,
    listReports: vi.fn().mockResolvedValue([]),
  };
});

describe("GET /api/reports query validation", () => {
  it("rejects non-numeric limit (limit=abc) with HTTP 400", async () => {
    const req = new Request("http://localhost/api/reports?limit=abc");
    const res = await GET(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toEqual({
      error: "VALIDATION_ERROR",
      message: "Invalid query parameters",
    });
  });

  it("rejects limit below minimum (limit=0) with HTTP 400", async () => {
    const req = new Request("http://localhost/api/reports?limit=0");
    const res = await GET(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toEqual({
      error: "VALIDATION_ERROR",
      message: "Invalid query parameters",
    });
  });

  it("rejects limit exceeding maximum (limit=9999) with HTTP 400", async () => {
    const req = new Request("http://localhost/api/reports?limit=9999");
    const res = await GET(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toEqual({
      error: "VALIDATION_ERROR",
      message: "Invalid query parameters",
    });
  });

  it("rejects cursor with invalid characters with HTTP 400", async () => {
    const req = new Request("http://localhost/api/reports?cursor=bad!cursor@#$");
    const res = await GET(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toEqual({
      error: "VALIDATION_ERROR",
      message: "Invalid query parameters",
    });
  });

  it("rejects cursor exceeding 64 characters with HTTP 400", async () => {
    const longCursor = "a".repeat(65);
    const req = new Request(`http://localhost/api/reports?cursor=${longCursor}`);
    const res = await GET(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toEqual({
      error: "VALIDATION_ERROR",
      message: "Invalid query parameters",
    });
  });

  it("accepts valid query parameters and returns HTTP 200", async () => {
    const req = new Request("http://localhost/api/reports?limit=25&cursor=valid_cursor-123");
    const res = await GET(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      reports: [],
      nextCursor: null,
    });
  });
});
