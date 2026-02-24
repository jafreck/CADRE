import { describe, it, expect } from 'vitest';
import { isCadreSelfRun } from '../../src/util/cadre-self-run.js';
import type { CadreConfig } from '../../src/config/schema.js';

function makeConfig(repository: string): CadreConfig {
  return { repository } as unknown as CadreConfig;
}

describe('isCadreSelfRun', () => {
  it('returns true for exact match', () => {
    expect(isCadreSelfRun(makeConfig('jafreck/cadre'))).toBe(true);
  });

  it('returns true for uppercase', () => {
    expect(isCadreSelfRun(makeConfig('JAFRECK/CADRE'))).toBe(true);
  });

  it('returns true for mixed case', () => {
    expect(isCadreSelfRun(makeConfig('Jafreck/Cadre'))).toBe(true);
  });

  it('returns false for a different repository', () => {
    expect(isCadreSelfRun(makeConfig('jafreck/other-repo'))).toBe(false);
  });

  it('returns false for a different owner', () => {
    expect(isCadreSelfRun(makeConfig('someoneelse/cadre'))).toBe(false);
  });
});
