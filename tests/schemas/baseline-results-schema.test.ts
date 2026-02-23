import { describe, it, expect } from 'vitest';
import { baselineResultsSchema } from '../../src/agents/schemas/index.js';

describe('baselineResultsSchema', () => {
  const valid = {
    buildExitCode: 0,
    testExitCode: 0,
    buildFailures: [],
    testFailures: [],
  };

  it('should accept a valid BaselineResults with no failures', () => {
    const result = baselineResultsSchema.safeParse(valid);
    expect(result.success).toBe(true);
  });

  it('should accept a valid BaselineResults with failures', () => {
    const result = baselineResultsSchema.safeParse({
      buildExitCode: 1,
      testExitCode: 1,
      buildFailures: ['TS2345: Argument of type string is not assignable'],
      testFailures: ['should handle login > timeout test'],
    });
    expect(result.success).toBe(true);
  });

  it('should reject when buildExitCode is missing', () => {
    const { buildExitCode: _b, ...without } = valid;
    const result = baselineResultsSchema.safeParse(without);
    expect(result.success).toBe(false);
  });

  it('should reject when testExitCode is missing', () => {
    const { testExitCode: _t, ...without } = valid;
    const result = baselineResultsSchema.safeParse(without);
    expect(result.success).toBe(false);
  });

  it('should reject when buildFailures is missing', () => {
    const { buildFailures: _bf, ...without } = valid;
    const result = baselineResultsSchema.safeParse(without);
    expect(result.success).toBe(false);
  });

  it('should reject when testFailures is missing', () => {
    const { testFailures: _tf, ...without } = valid;
    const result = baselineResultsSchema.safeParse(without);
    expect(result.success).toBe(false);
  });

  it('should reject non-numeric buildExitCode', () => {
    const result = baselineResultsSchema.safeParse({ ...valid, buildExitCode: 'zero' });
    expect(result.success).toBe(false);
  });

  it('should reject non-numeric testExitCode', () => {
    const result = baselineResultsSchema.safeParse({ ...valid, testExitCode: 'one' });
    expect(result.success).toBe(false);
  });

  it('should reject non-array buildFailures', () => {
    const result = baselineResultsSchema.safeParse({ ...valid, buildFailures: 'error string' });
    expect(result.success).toBe(false);
  });

  it('should reject non-array testFailures', () => {
    const result = baselineResultsSchema.safeParse({ ...valid, testFailures: 'error string' });
    expect(result.success).toBe(false);
  });

  it('should reject buildFailures containing non-strings', () => {
    const result = baselineResultsSchema.safeParse({ ...valid, buildFailures: [123, true] });
    expect(result.success).toBe(false);
  });

  it('should strip unknown extra fields', () => {
    const result = baselineResultsSchema.safeParse({ ...valid, unexpectedField: 'extra' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(Object.keys(result.data)).not.toContain('unexpectedField');
    }
  });
});
