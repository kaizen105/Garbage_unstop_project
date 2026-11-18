import { describe, it, expect, vi } from "vitest";
import { POST } from "./route";

vi.mock("@/lib/routing/router", () => ({
  fetchRoute: vi.fn().mockResolvedValue({ planned: null, bypass: null, hazmat: null }),
}));

describe("POST /api/route input validation", () => {
  it("rejects malformed non-empty JSON with HTTP 400", async () => {
    const req = new Request("http://localhost/api/route", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{ not a json",
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toEqual({
      error: "VALIDATION_ERROR",
      message: "Invalid payload",
    });
  });

  it("rejects out-of-range latitude (ZodError) with HTTP 400", async () => {
    const req = new Request("http://localhost/api/route", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ lat: 95, lng: 77.2 }),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toEqual({
      error: "VALIDATION_ERROR",
      message: "Invalid payload",
    });
  });

  it("rejects out-of-range longitude (ZodError) with HTTP 400", async () => {
    const req = new Request("http://localhost/api/route", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ lat: 28.6, lng: 200 }),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toEqual({
      error: "VALIDATION_ERROR",
      message: "Invalid payload",
    });
  });

  it("rejects non-numeric coordinates with HTTP 400", async () => {
    const req = new Request("http://localhost/api/route", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ lat: "abc", lng: 77.2 }),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toEqual({
      error: "VALIDATION_ERROR",
      message: "Invalid payload",
    });
  });

  it("accepts valid coordinates and returns HTTP 200", async () => {
    const req = new Request("http://localhost/api/route", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ lat: 28.6, lng: 77.2 }),
    });
    const res = await POST(req);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ planned: null, bypass: null, hazmat: null });
  });
});
