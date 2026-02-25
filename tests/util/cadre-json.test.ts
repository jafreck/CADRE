import { describe, it, expect } from 'vitest';
import { extractCadreJson } from '../../src/util/cadre-json';

function wrap(json: string): string {
  return `\`\`\`cadre-json\n${json}\n\`\`\``;
}

describe('extractCadreJson', () => {
  describe('valid JSON (no regression)', () => {
    it('parses a simple object', () => {
      const result = extractCadreJson(wrap('{"key": "value"}'));
      expect(result).toEqual({ key: 'value' });
    });

    it('parses an object with multiple fields', () => {
      const result = extractCadreJson(
        wrap('{\n  "title": "My PR",\n  "body": "Some body",\n  "labels": ["bug"]\n}'),
      );
      expect(result).toEqual({ title: 'My PR', body: 'Some body', labels: ['bug'] });
    });

    it('parses already-escaped quotes inside string values', () => {
      const result = extractCadreJson(wrap('{"title": "Fix \\"foo\\" bug"}'));
      expect(result).toEqual({ title: 'Fix "foo" bug' });
    });

    it('returns null when no cadre-json block exists', () => {
      expect(extractCadreJson('No fenced block here')).toBeNull();
    });

    it('returns null for a plain json block (wrong fence language)', () => {
      expect(extractCadreJson('```json\n{"key":"value"}\n```')).toBeNull();
    });
  });

  describe('recovery from unescaped quotes', () => {
    it('recovers a title with unescaped double-quotes', () => {
      const raw = '{"title": "Fix the "foo" parser", "body": "ok"}';
      const result = extractCadreJson(wrap(raw));
      expect(result).toEqual({ title: 'Fix the "foo" parser', body: 'ok' });
    });

    it('recovers a body with a quoted identifier', () => {
      const raw = '{"title": "PR", "body": "Use "bar" instead of "baz""}';
      const result = extractCadreJson(wrap(raw));
      expect(result).toEqual({ title: 'PR', body: 'Use "bar" instead of "baz"' });
    });

    it('recovers when the body contains a backtick code span description with inner quotes', () => {
      const raw = '{"title": "T", "body": "Set flag to "true" to enable"}';
      const result = extractCadreJson(wrap(raw));
      expect(result).toEqual({ title: 'T', body: 'Set flag to "true" to enable' });
    });
  });

  describe('unrecoverable JSON', () => {
    it('returns null for structurally broken JSON that cannot be recovered', () => {
      const raw = '{title: no quotes at all, really broken}}';
      expect(extractCadreJson(wrap(raw))).toBeNull();
    });

    it('returns null for a completely empty block', () => {
      expect(extractCadreJson(wrap(''))).toBeNull();
    });
  });
});
