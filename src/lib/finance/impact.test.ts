import { describe, it, expect } from 'vitest';
import { estimateImpact } from './impact';

describe('estimateImpact', () => {
  it('calculates 0 for routine_collection', () => {
    const res = estimateImpact({ hazard_category: 'chemical', severity_level: 10, action_required: 'routine_collection' });
    expect(res.prevented_inr).toBe(0);
    expect(res.net_inr).toBe(0);
  });

  it('calculates prevented cost and detour cost', () => {
    const res = estimateImpact(
      { hazard_category: 'chemical', severity_level: 10, action_required: 'dispatch_hazmat_bypass_standard' },
      { planned: { distance_m: 1000 }, bypass: { distance_m: 2000 } }
    );
    // chemical base = 120000, sev 10/10 = 1 => 120000
    // detour = 1000m (1km) * 30 = 30
    expect(res.prevented_inr).toBe(120000);
    expect(res.detour_inr).toBe(30);
    expect(res.net_inr).toBe(120000 - 30);
  });
});
