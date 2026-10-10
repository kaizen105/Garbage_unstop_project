import { describe, it, expect } from 'vitest';
import { tagWard } from './wards';

describe('tagWard', () => {
  it('returns unmapped for null coords', () => {
    expect(tagWard(null)).toEqual({ status: "unmapped" });
  });
  
  it('returns invalid_coordinates for out of bounds coords', () => {
    expect(tagWard({ lat: 100, lng: 0 })).toEqual({ status: "invalid_coordinates" });
  });

  it('returns matched or unmapped for valid points', () => {
    const res = tagWard({ lat: 28.6139, lng: 77.2090 });
    expect(["matched", "unmapped"]).toContain(res.status);
  });
});
