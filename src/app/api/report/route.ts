import { NextResponse } from "next/server";
import { transcribeAudio, GnaniError } from "../../../lib/gnani/prisma";
import { createReportRecord } from "../../../lib/reports/service";
import { z } from "zod";
import { TraceStage, timeStage } from "../../../lib/trace";

export const JsonBodySchema = z.object({
  text: z.string().min(1).max(2000),
  lat: z.number().optional(),
  lng: z.number().optional(),
});

export { getActionRequired } from "@/lib/dispatch";

export async function POST(request: Request) {
  try {
    const contentType = request.headers.get("content-type") || "";

    let text = "";
    let lat: number | undefined;
    let lng: number | undefined;
    let isMock = false;
    const audioStages: TraceStage[] = [];

    if (contentType.includes("multipart/form-data")) {
      const formData = await request.formData();
      const audioFile = formData.get("audio");
      lat = formData.get("lat") ? parseFloat(formData.get("lat") as string) : undefined;
      lng = formData.get("lng") ? parseFloat(formData.get("lng") as string) : undefined;
      const languageCode = formData.get("language_code")?.toString() || "hi-IN";

      if (!audioFile || !(audioFile instanceof Blob)) {
        return NextResponse.json({ error: "INVALID_AUDIO", message: "Missing or invalid audio" }, { status: 400 });
      }

      const filename = (audioFile as File).name || "audio.wav";
      
      const transcript = await timeStage(
        audioStages,
        "Transcription",
        () => transcribeAudio({ audio: audioFile, filename, languageCode }),
        (res) => (res.mock ? "Mock STT" : "Gnani STT")
      );
      text = transcript.text;
      isMock = transcript.mock;
    } else if (contentType.includes("application/json")) {
      const json = await request.json();
      const parsed = JsonBodySchema.parse(json);
      text = parsed.text;
      lat = parsed.lat;
      lng = parsed.lng;
    } else {
      return NextResponse.json(
        { error: "UNSUPPORTED_MEDIA_TYPE", message: "Must be multipart/form-data or application/json" },
        { status: 415 }
      );
    }

    const result = await createReportRecord({
      text,
      lat,
      lng,
      isMockTranscript: isMock,
    });

    if (audioStages.length > 0) {
      result.trace.stages = [...audioStages, ...result.trace.stages];
      result.trace.totalMs = Math.round((result.trace.totalMs + audioStages[0]!.ms) * 10) / 10;
    }

    return NextResponse.json(result);
  } catch (error: unknown) {
    if (error instanceof GnaniError) {
      let status = 500;
      switch (error.kind) {
        case "INVALID_AUDIO":
        case "AUDIO_TOO_LONG":
          status = 400;
          break;
        case "AUDIO_TOO_LARGE":
          status = 413;
          break;
        case "AUTH_OR_CREDITS":
          status = 401;
          break;
        case "RATE_LIMITED":
          status = 429;
          break;
        case "UPSTREAM_ERROR":
          status = 502;
          break;
        case "TIMEOUT":
          status = 504;
          break;
        case "EMPTY_TRANSCRIPT":
        case "BAD_RESPONSE":
          status = 422;
          break;
      }
      return NextResponse.json({ error: error.kind, message: error.message }, { status });
    }

    if (error instanceof z.ZodError) {
      return NextResponse.json({ error: "VALIDATION_ERROR", message: "Invalid payload" }, { status: 400 });
    }

    console.error("[Report Route Error]", error);
    return NextResponse.json({ error: "INTERNAL_ERROR", message: "An unexpected error occurred" }, { status: 500 });
  }
}
