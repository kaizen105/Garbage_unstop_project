import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { transcribeAudio, GnaniError } from './prisma';
import * as env from '../env';

vi.mock('../env', () => ({
  getEnv: vi.fn()
}));

const mockGetEnv = vi.mocked(env.getEnv);

describe('transcribeAudio', () => {
  beforeEach(() => {
    mockGetEnv.mockReturnValue({
      GNANI_API_KEY: 'test-key',
      GNANI_STT_URL: 'https://api.vachana.ai/stt/v3',
      LLM_PROVIDER: 'mock',
      LLM_BASE_URL: 'https://openrouter.ai/api/v1',
      NEXT_PUBLIC_MAP_PROVIDER: 'leaflet'
    } as unknown as ReturnType<typeof env.getEnv>);
    global.fetch = vi.fn();
  });
  
  afterEach(() => {
    vi.restoreAllMocks();
  });

  function createMockWav(duration: number) {
    const header = new ArrayBuffer(44);
    const view = new DataView(header);
    view.setUint32(0, 0x52494646, false);
    view.setUint32(8, 0x57415645, false);
    const byteRate = 16000 * 2;
    view.setUint32(28, byteRate, true);
    const dataSize = Math.floor(duration * byteRate);
    const fullBuffer = new ArrayBuffer(44 + dataSize);
    new Uint8Array(fullBuffer).set(new Uint8Array(header));
    return new Blob([fullBuffer], { type: 'audio/wav' });
  }

  async function expectGnaniError(promise: Promise<unknown>, expectedKind: string) {
    try {
      await promise;
      expect.unreachable('Should have thrown GnaniError');
    } catch (e: unknown) {
      expect(e).toBeInstanceOf(GnaniError);
      expect((e as GnaniError).kind).toBe(expectedKind);
    }
  }

  it('rejects empty audio', async () => {
    const audio = new Blob([], { type: 'audio/wav' });
    await expectGnaniError(transcribeAudio({ audio, filename: 'test.wav' }), "INVALID_AUDIO");
  });

  it('rejects oversized audio', async () => {
    const audio = new Blob([new ArrayBuffer(6 * 1024 * 1024)], { type: 'audio/wav' });
    await expectGnaniError(transcribeAudio({ audio, filename: 'test.wav' }), "AUDIO_TOO_LARGE");
  });
  
  it('rejects wrong type', async () => {
    const audio = new Blob(['test'], { type: 'text/plain' });
    await expectGnaniError(transcribeAudio({ audio, filename: 'test.txt' }), "INVALID_AUDIO");
  });

  it('rejects duration > 60s for wav', async () => {
    const audio = createMockWav(65);
    await expectGnaniError(transcribeAudio({ audio, filename: 'test.wav' }), "AUDIO_TOO_LONG");
  });

  it('mock mode works with no key', async () => {
    mockGetEnv.mockReturnValue({ GNANI_API_KEY: undefined } as unknown as ReturnType<typeof env.getEnv>);
    const audio = createMockWav(10);
    const res = await transcribeAudio({ audio, filename: 'test.wav' });
    expect(res.mock).toBe(true);
    expect(res.text).toBe("यह करोल बाग में एक बायोमेडिकल कचरा खतरा है।");
  });

  it('sends correct form data and parses success', async () => {
    const fetchMock = global.fetch as import("vitest").Mock;
    fetchMock.mockResolvedValueOnce({
      status: 200,
      ok: true,
      json: async () => ({ success: true, transcript: 'test transcript', request_id: 'req123' })
    });
    const audio = createMockWav(10);
    const res = await transcribeAudio({ audio, filename: 'test.wav', languageCode: 'hi-IN' });
    expect(res.text).toBe('test transcript');
    expect(res.request_id).toBe('req123');

    const fetchCall = fetchMock.mock.calls[0];
    if (!fetchCall) throw new Error("fetch not called");
    expect(fetchCall[0]).toBe('https://api.vachana.ai/stt/v3');
    const headers = fetchCall[1]?.headers as Record<string, string>;
    expect(headers['X-API-Key-ID']).toBe('test-key');
    const body = fetchCall[1]?.body as FormData;
    expect(body.get('language_code')).toBe('hi-IN');
    expect(body.get('format')).toBe('transcribe');
    expect(body.has('audio_file')).toBe(true);
  });

  it('retries once on 503', async () => {
    const fetchMock = global.fetch as import("vitest").Mock;
    fetchMock.mockResolvedValueOnce({ status: 503 });
    fetchMock.mockResolvedValueOnce({
      status: 200,
      ok: true,
      json: async () => ({ success: true, transcript: 'test', request_id: '123' })
    });
    const audio = createMockWav(10);
    const res = await transcribeAudio({ audio, filename: 'test.wav' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(res.text).toBe('test');
  });

  it('does not retry on 403', async () => {
    const fetchMock = global.fetch as import("vitest").Mock;
    fetchMock.mockResolvedValueOnce({ status: 403 });
    const audio = createMockWav(10);
    await expectGnaniError(transcribeAudio({ audio, filename: 'test.wav' }), "AUTH_OR_CREDITS");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('maps empty transcript to error', async () => {
    const fetchMock = global.fetch as import("vitest").Mock;
    fetchMock.mockResolvedValueOnce({
      status: 200,
      ok: true,
      json: async () => ({ success: true, transcript: '   ', request_id: '123' })
    });
    const audio = createMockWav(10);
    await expectGnaniError(transcribeAudio({ audio, filename: 'test.wav' }), "EMPTY_TRANSCRIPT");
  });
});
