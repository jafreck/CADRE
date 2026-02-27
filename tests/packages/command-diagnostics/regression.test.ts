import { describe, it, expect } from 'vitest';
import { computeRegressions } from '../../../packages/command-diagnostics/src/regression.js';

describe('computeRegressions', () => {
  it('should return empty array when no failures exist', () => {
    expect(computeRegressions([], new Set(['known-fail']))).toEqual([]);
  });

  it('should return empty array when all failures are in baseline', () => {
    const baseline = new Set(['fail-a', 'fail-b']);
    expect(computeRegressions(['fail-a', 'fail-b'], baseline)).toEqual([]);
  });

  it('should return failures not in baseline as regressions', () => {
    const baseline = new Set(['known-fail']);
    expect(computeRegressions(['known-fail', 'new-fail'], baseline)).toEqual(['new-fail']);
  });

  it('should treat all failures as regressions when baseline is empty', () => {
    expect(computeRegressions(['fail-1', 'fail-2'], new Set())).toEqual(['fail-1', 'fail-2']);
  });

  it('should return empty array when both inputs are empty', () => {
    expect(computeRegressions([], new Set())).toEqual([]);
  });

  it('should preserve order of regressions', () => {
    const baseline = new Set(['b']);
    expect(computeRegressions(['c', 'b', 'a'], baseline)).toEqual(['c', 'a']);
  });
});
