import { describe, it, expect } from 'vitest';
import { getActionRequired } from './route';

describe('getActionRequired rule', () => {
  it('dispatches hazmat bypass for hazmat category with severity >= 6', () => {
    expect(getActionRequired('biohazard_medical', 6)).toBe('dispatch_hazmat_bypass_standard');
    expect(getActionRequired('chemical', 10)).toBe('dispatch_hazmat_bypass_standard');
  });
  
  it('does bypass standard for hazmat < 6 but >= 7 (not possible since >=6 handles it)', () => {
    // Just testing logic flow
  });

  it('does routine collection for hazmat < 6', () => {
    expect(getActionRequired('electrical_hazard', 5)).toBe('routine_collection');
  });

  it('dispatches bypass standard for non-hazmat with severity >= 7', () => {
    expect(getActionRequired('general_overflow', 7)).toBe('bypass_standard');
    expect(getActionRequired('construction_debris', 9)).toBe('bypass_standard');
  });

  it('dispatches routine collection for non-hazmat with severity < 7', () => {
    expect(getActionRequired('unknown', 6)).toBe('routine_collection');
  });
});
