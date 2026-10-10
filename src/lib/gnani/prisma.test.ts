import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { transcribeAudio, GnaniError } from './prisma';
import * as env from '../env';

// Mock getEnv
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
    view.setUint32(0, 0x52494646, false); // RIFF
    view.setUint32(8, 0x57415645, false); // WAVE
    const byteRate = 16000 * 2;
    view.setUint32(28, byteRate, true);
    
    // Add fake data
    const dataSize = Math.floor(duration * byteRate);
    const fullBuffer = new ArrayBuffer(44 + dataSize);
    new Uint8Array(fullBuffer).set(new Uint8Array(header));
    
    return new Blob([fullBuffer], { type: 'audio/wav' });
  }

  it('rejects empty audio', async () => {
    const audio = new Blob([], { type: 'audio/wav' });
    await expect(transcribeAudio({ audio, filename: 'test.wav' }))
      .rejects.toThrowError(GnaniError);
  });

  it('rejects oversized audio', async () => {
    const audio = new Blob([new ArrayBuffer(6 * 1024 * 1024)], { type: 'audio/wav' });
    await expect(transcribeAudio({ audio, filename: 'test.wav' }))
      .rejects.toThrowError(/exceeds 5MB/);
  });
  
  it('rejects wrong type', async () => {
    const audio = new Blob(['test'], { type: 'text/plain' });
    await expect(transcribeAudio({ audio, filename: 'test.txt' }))
      .rejects.toThrowError(/Unsupported audio/);
  });

  it('rejects duration > 60s for wav', async () => {
    const audio = createMockWav(65);
    await expect(transcribeAudio({ audio, filename: 'test.wav' }))
      .rejects.toThrowError(/exceeds 60s/);
  });

  it('mock mode works with no key', async () => {
    mockGetEnv.mockReturnValue({ GNANI_API_KEY: undefined } as unknown as ReturnType<typeof env.getEnv>);
    const audio = createMockWav(10);
    const res = await transcribeAudio({ audio, filename: 'test.wav' });
    expect(res.mock).toBe(true);
    expect(res.text).toBe("यह करोल बाग में एक बायोमेडिकल कचरा खतरा है।");
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
    await expect(transcribeAudio({ audio, filename: 'test.wav' }))
      .rejects.toThrowError(/auth\/credits/);
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
    await expect(transcribeAudio({ audio, filename: 'test.wav' }))
      .rejects.toThrowError(/was empty/);
  });
});
