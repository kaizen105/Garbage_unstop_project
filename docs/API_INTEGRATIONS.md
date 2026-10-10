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
