import { describe, it, expect, vi, beforeEach } from "vitest";
import { POST } from "./route";
import { checkRateLimit, extractClientIp } from "@/lib/rateLimit";
import { transcribeAudio } from "@/lib/gnani/prisma";

vi.mock("@/lib/rateLimit", () => ({
  checkRateLimit: vi.fn(),
  extractClientIp: vi.fn(),
}));

vi.mock("@/lib/gnani/prisma", async () => {
  const actual = await vi.importActual<typeof import("@/lib/gnani/prisma")>("@/lib/gnani/prisma");
  return {
    ...actual,
    transcribeAudio: vi.fn(),
  };
});

describe("POST /api/transcribe rate limiting", () => {
  const mockCheckRateLimit = vi.mocked(checkRateLimit);
  const mockExtractClientIp = vi.mocked(extractClientIp);
  const mockTranscribeAudio = vi.mocked(transcribeAudio);

  beforeEach(() => {
    vi.clearAllMocks();
    mockExtractClientIp.mockReturnValue("198.51.100.24");
  });

  it("allowed request calls the limiter and reaches the transcribe service", async () => {
    mockCheckRateLimit.mockResolvedValueOnce({
      allowed: true,
      limit: 10,
      remaining: 9,
      retryAfterSeconds: 0,
    });

    mockTranscribeAudio.mockResolvedValueOnce({
      text: "Kooda pada hai yahan",
      language_code: "hi-IN",
      mock: true,
    });

    const formData = new FormData();
    formData.append("audio_file", new Blob(["audio-bytes"], { type: "audio/wav" }), "test.wav");
    formData.append("language_code", "hi-IN");

    const req = new Request("http://localhost/api/transcribe", {
      method: "POST",
      body: formData,
    });

    const res = await POST(req);
    expect(res.status).toBe(200);

    expect(mockExtractClientIp).toHaveBeenCalledTimes(1);
    expect(mockCheckRateLimit).toHaveBeenCalledTimes(1);
    expect(mockCheckRateLimit).toHaveBeenCalledWith("transcribe:198.51.100.24");

    expect(mockTranscribeAudio).toHaveBeenCalledTimes(1);
    const body = await res.json();
    expect(body).toEqual({
      text: "Kooda pada hai yahan",
      language_code: "hi-IN",
      mock: true,
    });
  });

  it("limited request returns HTTP 429 with Retry-After and does NOT call transcribe service", async () => {
    mockCheckRateLimit.mockResolvedValueOnce({
      allowed: false,
      limit: 10,
      remaining: 0,
      retryAfterSeconds: 75,
    });

    const formData = new FormData();
    formData.append("audio_file", new Blob(["audio-bytes"], { type: "audio/wav" }), "test.wav");

    const req = new Request("http://localhost/api/transcribe", {
      method: "POST",
      body: formData,
    });

    const res = await POST(req);
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("75");

    const body = await res.json();
    expect(body).toEqual({
      error: "RATE_LIMITED",
      message: "Rate limit exceeded. Please wait 75 seconds before submitting another request.",
      retryAfter: 75,
    });

    expect(mockCheckRateLimit).toHaveBeenCalledWith("transcribe:198.51.100.24");
    expect(mockTranscribeAudio).not.toHaveBeenCalled();
  });

  it("calls the rate limiter before the transcribe service is called", async () => {
    const callOrder: string[] = [];

    mockCheckRateLimit.mockImplementationOnce(async () => {
      callOrder.push("checkRateLimit");
      return {
        allowed: true,
        limit: 10,
        remaining: 9,
        retryAfterSeconds: 0,
      };
    });

    mockTranscribeAudio.mockImplementationOnce(async () => {
      callOrder.push("transcribeAudio");
      return {
        text: "Audio transcribed",
        language_code: "hi-IN",
        mock: true,
      };
    });

    const formData = new FormData();
    formData.append("audio_file", new Blob(["audio-bytes"], { type: "audio/wav" }), "test.wav");

    const req = new Request("http://localhost/api/transcribe", {
      method: "POST",
      body: formData,
    });

    const res = await POST(req);
    expect(res.status).toBe(200);

    expect(callOrder).toEqual(["checkRateLimit", "transcribeAudio"]);
  });
});
