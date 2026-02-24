import { describe, it, expect } from 'vitest';
import { commandResultSchema, integrationReportSchema } from '../../src/agents/schemas/index.js';

describe('commandResultSchema', () => {
  const valid = {
    command: 'npm run build',
    exitCode: 0,
    output: 'Build succeeded',
    pass: true,
  };

  it('should accept a valid CommandResult', () => {
    const result = commandResultSchema.safeParse(valid);
    expect(result.success).toBe(true);
  });

  it('should reject when pass field is missing', () => {
    const { pass: _p, ...without } = valid;
    const result = commandResultSchema.safeParse(without);
    expect(result.success).toBe(false);
  });

  it('should reject non-numeric exitCode', () => {
    const result = commandResultSchema.safeParse({ ...valid, exitCode: 'zero' });
    expect(result.success).toBe(false);
  });

  it('should accept a failing CommandResult', () => {
    const result = commandResultSchema.safeParse({ ...valid, exitCode: 1, pass: false });
    expect(result.success).toBe(true);
  });

  it('should accept a CommandResult with a signal (killed by OS)', () => {
    const result = commandResultSchema.safeParse({ ...valid, exitCode: -1, signal: 'SIGTERM', pass: false });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.signal).toBe('SIGTERM');
  });

  it('should accept a CommandResult with signal: null', () => {
    const result = commandResultSchema.safeParse({ ...valid, signal: null });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.signal).toBeNull();
  });

  it('should accept a CommandResult without the signal field (backwards compat)', () => {
    const result = commandResultSchema.safeParse(valid);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.signal).toBeUndefined();
  });
});

describe('integrationReportSchema', () => {
  const commandResult = { command: 'npm run build', exitCode: 0, output: '', pass: true };
  const valid = {
    buildResult: commandResult,
    testResult: { ...commandResult, command: 'npm test' },
    overallPass: true,
  };

  it('should accept a valid IntegrationReport without lintResult', () => {
    const result = integrationReportSchema.safeParse(valid);
    expect(result.success).toBe(true);
  });

  it('should reject when buildResult field is missing', () => {
    const { buildResult: _b, ...without } = valid;
    const result = integrationReportSchema.safeParse(without);
    expect(result.success).toBe(false);
  });

  it('should reject when testResult field is missing', () => {
    const { testResult: _t, ...without } = valid;
    const result = integrationReportSchema.safeParse(without);
    expect(result.success).toBe(false);
  });

  it('should reject when overallPass field is missing', () => {
    const { overallPass: _o, ...without } = valid;
    const result = integrationReportSchema.safeParse(without);
    expect(result.success).toBe(false);
  });

  it('should accept a valid IntegrationReport with optional lintResult', () => {
    const result = integrationReportSchema.safeParse({
      ...valid,
      lintResult: { ...commandResult, command: 'npm run lint' },
    });
    expect(result.success).toBe(true);
  });

  it('should reject a malformed lintResult', () => {
    const result = integrationReportSchema.safeParse({
      ...valid,
      lintResult: { command: 'npm run lint' }, // missing exitCode, output, pass
    });
    expect(result.success).toBe(false);
  });

  it('should strip unknown extra fields', () => {
    const result = integrationReportSchema.safeParse({ ...valid, unexpectedField: 'extra' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(Object.keys(result.data)).not.toContain('unexpectedField');
    }
  });

  it('should accept a valid IntegrationReport without baselineFailures or regressionFailures', () => {
    const result = integrationReportSchema.safeParse(valid);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.baselineFailures).toBeUndefined();
      expect(result.data.regressionFailures).toBeUndefined();
    }
  });

  it('should accept baselineFailures as an array of strings', () => {
    const result = integrationReportSchema.safeParse({
      ...valid,
      baselineFailures: ['build', 'test-suite-A'],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.baselineFailures).toEqual(['build', 'test-suite-A']);
    }
  });

  it('should accept regressionFailures as an array of strings', () => {
    const result = integrationReportSchema.safeParse({
      ...valid,
      regressionFailures: ['test-suite-B'],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.regressionFailures).toEqual(['test-suite-B']);
    }
  });

  it('should accept both baselineFailures and regressionFailures together', () => {
    const result = integrationReportSchema.safeParse({
      ...valid,
      baselineFailures: ['build'],
      regressionFailures: ['test-suite-C'],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.baselineFailures).toEqual(['build']);
      expect(result.data.regressionFailures).toEqual(['test-suite-C']);
    }
  });

  it('should accept empty arrays for baselineFailures and regressionFailures', () => {
    const result = integrationReportSchema.safeParse({
      ...valid,
      baselineFailures: [],
      regressionFailures: [],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.baselineFailures).toEqual([]);
      expect(result.data.regressionFailures).toEqual([]);
    }
  });

  it('should reject baselineFailures when it contains non-string elements', () => {
    const result = integrationReportSchema.safeParse({
      ...valid,
      baselineFailures: [123, 'valid'],
    });
    expect(result.success).toBe(false);
  });

  it('should reject regressionFailures when it is not an array', () => {
    const result = integrationReportSchema.safeParse({
      ...valid,
      regressionFailures: 'not-an-array',
    });
    expect(result.success).toBe(false);
  });
});
