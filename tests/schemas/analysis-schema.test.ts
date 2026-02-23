import { describe, it, expect } from 'vitest';
import { analysisSchema } from '../../src/agents/schemas/index.js';

describe('analysisSchema', () => {
  const valid = {
    requirements: ['req1', 'req2'],
    changeType: 'feature',
    scope: 'medium',
    affectedAreas: ['src/core'],
    ambiguities: [],
  };

  it('should accept a valid AnalysisResult', () => {
    const result = analysisSchema.safeParse(valid);
    expect(result.success).toBe(true);
  });

  it('should reject when requirements field is missing', () => {
    const { requirements: _r, ...without } = valid;
    const result = analysisSchema.safeParse(without);
    expect(result.success).toBe(false);
  });

  it('should reject an unknown changeType value', () => {
    const result = analysisSchema.safeParse({ ...valid, changeType: 'unknown' });
    expect(result.success).toBe(false);
  });

  it('should reject an unknown scope value', () => {
    const result = analysisSchema.safeParse({ ...valid, scope: 'huge' });
    expect(result.success).toBe(false);
  });

  it('should accept an empty ambiguities array', () => {
    const result = analysisSchema.safeParse({ ...valid, ambiguities: [] });
    expect(result.success).toBe(true);
  });

  it('should reject when affectedAreas field is missing', () => {
    const { affectedAreas: _a, ...without } = valid;
    const result = analysisSchema.safeParse(without);
    expect(result.success).toBe(false);
  });

  it('should accept all valid changeType values', () => {
    const types = ['bug-fix', 'feature', 'refactor', 'docs', 'chore'];
    for (const changeType of types) {
      const result = analysisSchema.safeParse({ ...valid, changeType });
      expect(result.success).toBe(true);
    }
  });

  it('should accept all valid scope values', () => {
    const scopes = ['small', 'medium', 'large'];
    for (const scope of scopes) {
      const result = analysisSchema.safeParse({ ...valid, scope });
      expect(result.success).toBe(true);
    }
  });

  it('should strip unknown extra fields', () => {
    const result = analysisSchema.safeParse({ ...valid, unexpectedField: 'extra' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(Object.keys(result.data)).not.toContain('unexpectedField');
    }
  });
});
