import { describe, it, expect } from 'vitest';
import { scoutReportSchema } from '../../src/agents/schemas/index.js';

describe('scoutReportSchema', () => {
  const valid = {
    relevantFiles: [{ path: 'src/foo.ts', reason: 'core module' }],
    dependencyMap: { 'src/foo.ts': ['src/bar.ts'] },
    testFiles: ['tests/foo.test.ts'],
    estimatedChanges: [{ path: 'src/foo.ts', linesEstimate: 20 }],
  };

  it('should accept a valid ScoutReport', () => {
    const result = scoutReportSchema.safeParse(valid);
    expect(result.success).toBe(true);
  });

  it('should reject when dependencyMap field is missing', () => {
    const { dependencyMap: _d, ...without } = valid;
    const result = scoutReportSchema.safeParse(without);
    expect(result.success).toBe(false);
  });

  it('should reject when relevantFiles entry is missing reason', () => {
    const result = scoutReportSchema.safeParse({
      ...valid,
      relevantFiles: [{ path: 'src/foo.ts' }],
    });
    expect(result.success).toBe(false);
  });

  it('should reject non-numeric linesEstimate', () => {
    const result = scoutReportSchema.safeParse({
      ...valid,
      estimatedChanges: [{ path: 'src/foo.ts', linesEstimate: 'twenty' }],
    });
    expect(result.success).toBe(false);
  });

  it('should accept empty arrays for relevantFiles, testFiles, and estimatedChanges', () => {
    const result = scoutReportSchema.safeParse({
      relevantFiles: [],
      dependencyMap: {},
      testFiles: [],
      estimatedChanges: [],
    });
    expect(result.success).toBe(true);
  });

  it('should reject when estimatedChanges entry is missing linesEstimate', () => {
    const result = scoutReportSchema.safeParse({
      ...valid,
      estimatedChanges: [{ path: 'src/foo.ts' }],
    });
    expect(result.success).toBe(false);
  });

  it('should strip unknown extra fields', () => {
    const result = scoutReportSchema.safeParse({ ...valid, unexpectedField: 'extra' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(Object.keys(result.data)).not.toContain('unexpectedField');
    }
  });
});
