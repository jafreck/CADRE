import { describe, it, expect } from 'vitest';
import { prContentSchema } from '../../src/agents/schemas/index.js';

describe('prContentSchema', () => {
  const valid = {
    title: 'Add feature X',
    body: 'This PR adds feature X by doing Y.',
    labels: ['enhancement'],
  };

  it('should accept a valid PRContent', () => {
    const result = prContentSchema.safeParse(valid);
    expect(result.success).toBe(true);
  });

  it('should reject when title field is missing', () => {
    const { title: _t, ...without } = valid;
    const result = prContentSchema.safeParse(without);
    expect(result.success).toBe(false);
  });

  it('should reject when body field is missing', () => {
    const { body: _b, ...without } = valid;
    const result = prContentSchema.safeParse(without);
    expect(result.success).toBe(false);
  });

  it('should reject when labels field is missing', () => {
    const { labels: _l, ...without } = valid;
    const result = prContentSchema.safeParse(without);
    expect(result.success).toBe(false);
  });

  it('should accept PRContent with empty labels array', () => {
    const result = prContentSchema.safeParse({ ...valid, labels: [] });
    expect(result.success).toBe(true);
  });

  it('should reject non-string label entries', () => {
    const result = prContentSchema.safeParse({ ...valid, labels: [42] });
    expect(result.success).toBe(false);
  });

  it('should strip unknown extra fields', () => {
    const result = prContentSchema.safeParse({ ...valid, unexpectedField: 'extra' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(Object.keys(result.data)).not.toContain('unexpectedField');
    }
  });
});
