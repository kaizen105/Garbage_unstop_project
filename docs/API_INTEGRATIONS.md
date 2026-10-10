# API Integrations

## Gnani STT (Vachana)
- **Endpoint**: `POST https://api.vachana.ai/stt/v3`
- **Auth**: `X-API-Key-ID: <GNANI_API_KEY>`
- **Request Type**: `multipart/form-data`
- **Fields**: 
  - `audio_file` (File, required) - Supported: WAV, MP3, OGG, FLAC, AAC, M4A
  - `language_code` (String, required) - e.g., `hi-IN`
  - `format` (String, optional) - Set to `transcribe`
- **Response**: `{ success: boolean, request_id: string, timestamp: string, transcript: string }`
- **Limits**: Max ~30s recommended, 60s hard limit. Client-side rejects files >5MB or >60s.

## LLM Provider (OpenRouter / Evon / Mock)
- **Endpoint**: POST `{LLM_BASE_URL}/chat/completions`
- **Auth**: `Bearer {LLM_API_KEY}`
- **Extraction Behavior**:
  - `LLM_PROVIDER="mock"` uses keyword-based fake extraction.
  - Model strips `<think>...</think>` tags and parses the first balanced JSON object.
  - Implements a single corrective retry if JSON parsing fails.
  - Degrades gracefully to `{ hazard_category:"unknown", severity_level:5, raw_location:"" }` with `degraded: true` if extraction fully fails.

## Coordinates Policy
- **Priority 1**: Valid GPS (lat -90..90, lng -180..180) from device navigator.
- **Priority 2**: Gazetteer name match based on a static list of ~15 landmarks.
- **Priority 3**: Null coordinates.
- **Rule**: Never trust or use LLM-invented/hallucinated coordinates.
