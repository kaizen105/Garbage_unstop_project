import { describe, it, expect } from 'vitest';
import { resolveCoordinates } from './locate';

describe('resolveCoordinates', () => {
  it('resolves Devanagari alias for Connaught Place', () => {
    const res = resolveCoordinates({ rawLocation: "कनॉट प्लेस के पास मलबा" });
    expect(res).toBeDefined();
    expect(res?.lat).toBe(28.6315);
    expect(res?.source).toBe("gazetteer");
  });
});
