import { NextResponse } from "next/server";
import { transcribeAudio, GnaniError } from "../../../lib/gnani/prisma";
import { extractHazard } from "../../../lib/llm/extract";
import { resolveCoordinates } from "../../../lib/spatial/locate";
import { tagWard } from "../../../lib/spatial/wards";
import { z } from "zod";

const JsonBodySchema = z.object({
  text: z.string().min(1).max(2000),
  lat: z.number().optional(),
  lng: z.number().optional()
});

export function getActionRequired(category: string, severity: number) {
  const hazmat = ["biohazard_medical", "chemical", "electrical_hazard"];
  if (hazmat.includes(category) && severity >= 6) {
    return "dispatch_hazmat_bypass_standard";
  }
  if (severity >= 7) {
    return "bypass_standard";
  }
  return "routine_collection";
}

export async function POST(request: Request) {
  try {
    const contentType = request.headers.get("content-type") || "";
    
    let text = "";
    let lat: number | undefined;
    let lng: number | undefined;
    let isMock = false;

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
      const transcript = await transcribeAudio({ audio: audioFile, filename, languageCode });
      text = transcript.text;
      isMock = transcript.mock;
    } else if (contentType.includes("application/json")) {
      const json = await request.json();
      const parsed = JsonBodySchema.parse(json);
      text = parsed.text;
      lat = parsed.lat;
      lng = parsed.lng;
    } else {
      return NextResponse.json({ error: "UNSUPPORTED_MEDIA_TYPE", message: "Must be multipart/form-data or application/json" }, { status: 415 });
    }

    const extraction = await extractHazard(text);
    const coords = resolveCoordinates({ lat, lng, rawLocation: extraction.raw_location });
    
    const action_required = getActionRequired(extraction.hazard_category, extraction.severity_level);
    
    const report_id = "HZ-" + Math.floor(1000 + Math.random() * 9000).toString();

    const report = {
      report_id,
      hazard_category: extraction.hazard_category,
      severity_level: extraction.severity_level,
      raw_location: extraction.raw_location,
      coordinates: coords ? { lat: coords.lat, lng: coords.lng } : null,
      action_required,
      ward: tagWard(coords ? { lat: coords.lat, lng: coords.lng } : null)
    };

    return NextResponse.json({
      report,
      transcript: text,
      transcript_mock: isMock,
      degraded: extraction.degraded || false
    });

  } catch (error: unknown) {
    if (error instanceof GnaniError) {
      let status = 500;
      switch (error.kind) {
        case "INVALID_AUDIO": case "AUDIO_TOO_LONG": status = 400; break;
        case "AUDIO_TOO_LARGE": status = 413; break;
        case "AUTH_OR_CREDITS": status = 401; break;
        case "RATE_LIMITED": status = 429; break;
        case "UPSTREAM_ERROR": status = 502; break;
        case "TIMEOUT": status = 504; break;
        case "EMPTY_TRANSCRIPT": case "BAD_RESPONSE": status = 422; break;
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
