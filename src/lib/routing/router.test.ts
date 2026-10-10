import { describe, it, expect, vi } from 'vitest';
import { fetchRoute } from './router';

describe('fetchRoute', () => {
  it('falls back to straight lines on fetch failure', async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error("Network Error"));
    
    const res = await fetchRoute({ lat: 28.6139, lng: 77.2090 });
    expect(res.approximate).toBe(true);
    expect(res.planned.geometry.type).toBe("LineString");
    expect(res.bypass.geometry.type).toBe("LineString");
    expect(res.hazmat.geometry.type).toBe("LineString");
  });
});
