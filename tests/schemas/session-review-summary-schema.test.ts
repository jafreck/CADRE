import { describe, it, expect } from 'vitest';
import { sessionReviewSummarySchema } from '../../src/agents/schemas/index.js';

describe('sessionReviewSummarySchema', () => {
  const valid = {
    sessionId: 'session-001',
    verdict: 'pass',
    summary: 'All changes look good.',
    keyFindings: ['No regressions found', 'Tests all pass'],
  };

  it('should accept a valid SessionReviewSummary with verdict pass', () => {
    const result = sessionReviewSummarySchema.safeParse(valid);
    expect(result.success).toBe(true);
  });

  it('should accept a valid SessionReviewSummary with verdict needs-fixes', () => {
    const result = sessionReviewSummarySchema.safeParse({ ...valid, verdict: 'needs-fixes' });
    expect(result.success).toBe(true);
  });

  it('should accept an empty keyFindings array', () => {
    const result = sessionReviewSummarySchema.safeParse({ ...valid, keyFindings: [] });
    expect(result.success).toBe(true);
  });

  it('should reject when sessionId is missing', () => {
    const { sessionId: _s, ...without } = valid;
    const result = sessionReviewSummarySchema.safeParse(without);
    expect(result.success).toBe(false);
  });

  it('should reject when verdict is missing', () => {
    const { verdict: _v, ...without } = valid;
    const result = sessionReviewSummarySchema.safeParse(without);
    expect(result.success).toBe(false);
  });

  it('should reject when summary is missing', () => {
    const { summary: _s, ...without } = valid;
    const result = sessionReviewSummarySchema.safeParse(without);
    expect(result.success).toBe(false);
  });

  it('should reject when keyFindings is missing', () => {
    const { keyFindings: _k, ...without } = valid;
    const result = sessionReviewSummarySchema.safeParse(without);
    expect(result.success).toBe(false);
  });

  it('should reject an unknown verdict value', () => {
    const result = sessionReviewSummarySchema.safeParse({ ...valid, verdict: 'rejected' });
    expect(result.success).toBe(false);
  });

  it('should reject when keyFindings contains non-string values', () => {
    const result = sessionReviewSummarySchema.safeParse({ ...valid, keyFindings: [1, 2, 3] });
    expect(result.success).toBe(false);
  });

  it('should reject when sessionId is not a string', () => {
    const result = sessionReviewSummarySchema.safeParse({ ...valid, sessionId: 123 });
    expect(result.success).toBe(false);
  });

  it('should strip unknown extra fields', () => {
    const result = sessionReviewSummarySchema.safeParse({ ...valid, unexpectedField: 'extra' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(Object.keys(result.data)).not.toContain('unexpectedField');
    }
  });

  it('should return correct parsed data', () => {
    const result = sessionReviewSummarySchema.safeParse(valid);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.sessionId).toBe('session-001');
      expect(result.data.verdict).toBe('pass');
      expect(result.data.summary).toBe('All changes look good.');
      expect(result.data.keyFindings).toEqual(['No regressions found', 'Tests all pass']);
    }
  });
});
