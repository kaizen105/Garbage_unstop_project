import { GnaniTranscript, GnaniLanguageCodeSchema, GnaniErrorKind } from "../validation/schemas";
import { getEnv } from "../env";

export class GnaniError extends Error {
  constructor(public kind: GnaniErrorKind, message: string, public status?: number) {
    super(message);
    this.name = "GnaniError";
  }
}

const ALLOWED_MIME = ["audio/wav", "audio/mpeg", "audio/ogg", "audio/flac", "audio/aac", "audio/mp4", "audio/x-m4a"];
const ALLOWED_EXT = ["wav", "mp3", "ogg", "flac", "aac", "m4a"];
const MAX_SIZE = 5 * 1024 * 1024; // 5 MB

function getWavDuration(buffer: ArrayBuffer): number | null {
  if (buffer.byteLength < 44) return null;
  const view = new DataView(buffer);
  if (view.getUint32(0, false) !== 0x52494646) return null; // RIFF
  if (view.getUint32(8, false) !== 0x57415645) return null; // WAVE
  const byteRate = view.getUint32(28, true);
  if (byteRate === 0) return null;
  return (buffer.byteLength - 44) / byteRate;
}

export async function transcribeAudio({ 
  audio, 
  filename, 
  languageCode = "hi-IN" 
}: { 
  audio: Blob; 
  filename: string; 
  languageCode?: string 
}): Promise<GnaniTranscript> {
  const env = getEnv();
  
  if (!audio || audio.size === 0) {
    throw new GnaniError("INVALID_AUDIO", "Audio file is empty.");
  }
  if (audio.size > MAX_SIZE) {
    throw new GnaniError("AUDIO_TOO_LARGE", "Audio file exceeds 5MB limit.");
  }
  
  const ext = filename.split(".").pop()?.toLowerCase() || "";
  if (!ALLOWED_EXT.includes(ext) || !ALLOWED_MIME.includes(audio.type)) {
    throw new GnaniError("INVALID_AUDIO", "Unsupported audio format.");
  }

  const parsedLang = GnaniLanguageCodeSchema.safeParse(languageCode);
  if (!parsedLang.success) {
    throw new GnaniError("INVALID_AUDIO", "Unsupported language code.");
  }
  
  if (ext === "wav" || audio.type === "audio/wav") {
    const arrayBuffer = await audio.arrayBuffer();
    const duration = getWavDuration(arrayBuffer);
    if (duration !== null) {
      if (duration > 60) {
        throw new GnaniError("AUDIO_TOO_LONG", "Audio duration exceeds 60s hard limit.");
      }
      if (duration > 30) {
        console.warn(`[Gnani] Audio duration is ${duration.toFixed(1)}s (recommended max 30s)`);
      }
    }
  }

  if (!env.GNANI_API_KEY) {
    return {
      text: "यह करोल बाग में एक बायोमेडिकल कचरा खतरा है।",
      language_code: parsedLang.data,
      mock: true,
      request_id: "mock-" + Date.now()
    };
  }

  const formData = new FormData();
  formData.append("audio_file", audio, filename);
  formData.append("language_code", parsedLang.data);
  formData.append("format", "transcribe");

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);

  let response: Response;
  try {
    const fetchGnani = () => fetch(env.GNANI_STT_URL, {
      method: "POST",
      headers: { "X-API-Key-ID": env.GNANI_API_KEY as string },
      body: formData,
      signal: controller.signal
    });

    response = await fetchGnani();
    if ([429, 500, 503].includes(response.status)) {
      await new Promise(r => setTimeout(r, 500));
      response = await fetchGnani();
    }
  } catch (error: unknown) {
    clearTimeout(timeout);
    if (error instanceof Error && error.name === "AbortError") {
      throw new GnaniError("TIMEOUT", "Gnani STT request timed out.");
    }
    throw new GnaniError("UPSTREAM_ERROR", "Network error reaching Gnani STT.");
  } finally {
    clearTimeout(timeout);
  }

  if (response.status === 400 || response.status === 413) {
    throw new GnaniError("INVALID_AUDIO", "Gnani rejected audio (400/413)", response.status);
  } else if (response.status === 403 || response.status === 401) {
    throw new GnaniError("AUTH_OR_CREDITS", "Gnani auth/credits error", response.status);
  } else if (response.status === 429) {
    throw new GnaniError("RATE_LIMITED", "Gnani rate limited", response.status);
  } else if (!response.ok) {
    throw new GnaniError("UPSTREAM_ERROR", `Gnani returned ${response.status}`, response.status);
  }

  let data;
  try {
    data = await response.json();
  } catch {
    throw new GnaniError("BAD_RESPONSE", "Invalid JSON from Gnani");
  }

  if (!data.success) {
    throw new GnaniError("UPSTREAM_ERROR", data.error?.message || "Unknown error from Gnani");
  }

  const transcript = data.transcript?.trim();
  if (!transcript) {
    console.log(`[Gnani] Request ${data.request_id}: EMPTY_TRANSCRIPT`);
    throw new GnaniError("EMPTY_TRANSCRIPT", "Transcript was empty");
  }

  console.log(`[Gnani] Request ${data.request_id}: Success`);
  
  return {
    text: transcript,
    language_code: parsedLang.data,
    request_id: data.request_id,
    mock: false
  };
}
