import { NextResponse } from "next/server";
import { transcribeAudio, GnaniError } from "@/lib/gnani/prisma";

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const audioFile = formData.get("audio_file");
    const languageCode = formData.get("language_code")?.toString() || "hi-IN";

    if (!audioFile || !(audioFile instanceof Blob)) {
      return NextResponse.json({ error: "INVALID_AUDIO", message: "Missing or invalid audio_file" }, { status: 400 });
    }

    const filename = (audioFile as File).name || "audio.wav";
    const transcript = await transcribeAudio({ audio: audioFile, filename, languageCode });
    return NextResponse.json(transcript);
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
    
    console.error("[Transcribe Route Error]", error);
    return NextResponse.json({ error: "INTERNAL_ERROR", message: "An unexpected error occurred" }, { status: 500 });
  }
}
