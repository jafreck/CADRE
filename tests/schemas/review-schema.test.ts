import { describe, it, expect } from 'vitest';
import { reviewIssueSchema, reviewSchema } from '../../src/agents/schemas/index.js';

describe('reviewIssueSchema', () => {
  const valid = {
    file: 'src/auth.ts',
    severity: 'error',
    description: 'Missing null check',
  };

  it('should accept a valid ReviewIssue without line', () => {
    const result = reviewIssueSchema.safeParse(valid);
    expect(result.success).toBe(true);
  });

  it('should reject when file field is missing', () => {
    const { file: _f, ...without } = valid;
    const result = reviewIssueSchema.safeParse(without);
    expect(result.success).toBe(false);
  });

  it('should reject an unknown severity value', () => {
    const result = reviewIssueSchema.safeParse({ ...valid, severity: 'critical' });
    expect(result.success).toBe(false);
  });

  it('should accept a ReviewIssue with optional line number', () => {
    const result = reviewIssueSchema.safeParse({ ...valid, line: 42 });
    expect(result.success).toBe(true);
  });

  it('should accept all valid severity values', () => {
    const severities = ['error', 'warning', 'suggestion'];
    for (const severity of severities) {
      const result = reviewIssueSchema.safeParse({ ...valid, severity });
      expect(result.success).toBe(true);
    }
  });

  it('should strip unknown extra fields', () => {
    const result = reviewIssueSchema.safeParse({ ...valid, unexpectedField: 'extra' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(Object.keys(result.data)).not.toContain('unexpectedField');
    }
  });
});

describe('reviewSchema', () => {
  const valid = {
    verdict: 'pass',
    issues: [],
    summary: 'All checks passed',
  };

  it('should accept a valid ReviewResult with no issues', () => {
    const result = reviewSchema.safeParse(valid);
    expect(result.success).toBe(true);
  });

  it('should reject when summary field is missing', () => {
    const { summary: _s, ...without } = valid;
    const result = reviewSchema.safeParse(without);
    expect(result.success).toBe(false);
  });

  it('should reject an unknown verdict value', () => {
    const result = reviewSchema.safeParse({ ...valid, verdict: 'rejected' });
    expect(result.success).toBe(false);
  });

  it('should reject when issues field is missing', () => {
    const { issues: _i, ...without } = valid;
    const result = reviewSchema.safeParse(without);
    expect(result.success).toBe(false);
  });

  it('should accept a ReviewResult with issues', () => {
    const result = reviewSchema.safeParse({
      verdict: 'needs-fixes',
      issues: [{ file: 'src/foo.ts', severity: 'error', description: 'Bug' }],
      summary: 'Issues found',
    });
    expect(result.success).toBe(true);
  });

  it('should strip unknown extra fields', () => {
    const result = reviewSchema.safeParse({ ...valid, unexpectedField: 'extra' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(Object.keys(result.data)).not.toContain('unexpectedField');
    }
  });
});
