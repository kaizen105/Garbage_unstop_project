import { describe, it, expect, vi } from 'vitest';
import { extractJSON } from './parse';
import { extractHazard } from './extract';
import * as provider from './provider';

vi.mock('./provider', () => ({
  chat: vi.fn()
}));

vi.mock('../env', () => ({
  getEnv: () => ({ LLM_PROVIDER: 'openrouter' })
}));

describe('LLM Extraction', () => {
  it('strips <think> tags and parses JSON', () => {
    const raw = "<think>I need to parse this...</think>\n```json\n{\"hazard_category\":\"chemical\", \"severity_level\":10, \"raw_location\":\"factory\"}\n```";
    const res = extractJSON(raw);
    expect(res).toEqual({ hazard_category: "chemical", severity_level: 10, raw_location: "factory" });
  });

  it('retries on parse failure and falls back to degraded on double failure', async () => {
    const chatMock = vi.mocked(provider.chat);
    chatMock.mockResolvedValueOnce("Invalid JSON text");
    chatMock.mockResolvedValueOnce("Still invalid");
    
    const res = await extractHazard("Bad data");
    expect(res).toEqual({ hazard_category: "unknown", severity_level: 5, raw_location: "", degraded: true });
    expect(chatMock).toHaveBeenCalledTimes(2);
  });
});
