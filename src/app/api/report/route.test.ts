import { describe, it, expect, vi } from "vitest";
import { getActionRequired, POST } from "./route";

vi.mock("@/lib/rateLimit", () => ({
  checkRateLimit: vi.fn().mockResolvedValue({ allowed: true, retryAfterSeconds: 0 }),
  extractClientIp: vi.fn().mockReturnValue("127.0.0.1"),
}));

vi.mock("@/lib/reports/service", () => ({
  createReportRecord: vi.fn().mockResolvedValue({
    report: { report_id: "HZ-12345678" },
    trace: { stages: [], totalMs: 0 },
  }),
}));

describe("getActionRequired rule", () => {
  it("dispatches hazmat bypass for hazmat category with severity >= 6", () => {
    expect(getActionRequired("biohazard_medical", 6)).toBe("dispatch_hazmat_bypass_standard");
    expect(getActionRequired("chemical", 10)).toBe("dispatch_hazmat_bypass_standard");
  });

  it("does bypass standard for hazmat < 6 but >= 7 (not possible since >=6 handles it)", () => {
    // Just testing logic flow
  });

  it("does routine collection for hazmat < 6", () => {
    expect(getActionRequired("electrical_hazard", 5)).toBe("routine_collection");
  });

  it("dispatches bypass standard for non-hazmat with severity >= 7", () => {
    expect(getActionRequired("general_overflow", 7)).toBe("bypass_standard");
    expect(getActionRequired("construction_debris", 9)).toBe("bypass_standard");
  });

  it("dispatches routine collection for non-hazmat with severity < 7", () => {
    expect(getActionRequired("unknown", 6)).toBe("routine_collection");
  });
});

describe("POST /api/report coordinate validation", () => {
  it("rejects JSON with out-of-range latitude (>90) with HTTP 400", async () => {
    const req = new Request("http://localhost/api/report", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: "Test hazard overflow", lat: 95, lng: 77.2 }),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toEqual({
      error: "VALIDATION_ERROR",
      message: "Invalid payload",
    });
  });

  it("rejects JSON with out-of-range longitude (>180) with HTTP 400", async () => {
    const req = new Request("http://localhost/api/report", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: "Test hazard overflow", lat: 28.5, lng: 195 }),
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toEqual({
      error: "VALIDATION_ERROR",
      message: "Invalid payload",
    });
  });

  it("rejects multipart form with NaN latitude with HTTP 400", async () => {
    const formData = new FormData();
    formData.append("lat", "not-a-number");
    formData.append("lng", "77.2");
    formData.append("audio", new Blob(["mock"], { type: "audio/wav" }), "audio.wav");

    const req = new Request("http://localhost/api/report", {
      method: "POST",
      body: formData,
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toEqual({
      error: "VALIDATION_ERROR",
      message: "Invalid latitude",
    });
  });

  it("rejects multipart form with out-of-range latitude with HTTP 400", async () => {
    const formData = new FormData();
    formData.append("lat", "120");
    formData.append("lng", "77.2");
    formData.append("audio", new Blob(["mock"], { type: "audio/wav" }), "audio.wav");

    const req = new Request("http://localhost/api/report", {
      method: "POST",
      body: formData,
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toEqual({
      error: "VALIDATION_ERROR",
      message: "Invalid latitude",
    });
  });

  it("rejects multipart form with NaN longitude with HTTP 400", async () => {
    const formData = new FormData();
    formData.append("lat", "28.5");
    formData.append("lng", "invalid-lng");
    formData.append("audio", new Blob(["mock"], { type: "audio/wav" }), "audio.wav");

    const req = new Request("http://localhost/api/report", {
      method: "POST",
      body: formData,
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toEqual({
      error: "VALIDATION_ERROR",
      message: "Invalid longitude",
    });
  });

  it("rejects multipart form with out-of-range longitude with HTTP 400", async () => {
    const formData = new FormData();
    formData.append("lat", "28.5");
    formData.append("lng", "-200");
    formData.append("audio", new Blob(["mock"], { type: "audio/wav" }), "audio.wav");

    const req = new Request("http://localhost/api/report", {
      method: "POST",
      body: formData,
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body).toEqual({
      error: "VALIDATION_ERROR",
      message: "Invalid longitude",
    });
  });
});
