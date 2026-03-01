import { describe, it, expect } from 'vitest';
import { extractCadreJson, extractCadreJsonWithError } from '../../../../packages/agent-runtime/src/output/cadre-json.js';

function wrap(json: string): string {
  return `\`\`\`cadre-json\n${json}\n\`\`\``;
}

describe('extractCadreJson (agent-runtime)', () => {
  describe('valid JSON parsing', () => {
    it('should parse a simple object', () => {
      expect(extractCadreJson(wrap('{"key": "value"}'))).toEqual({ key: 'value' });
    });

    it('should parse an array', () => {
      expect(extractCadreJson(wrap('[1, 2, 3]'))).toEqual([1, 2, 3]);
    });

    it('should parse nested objects', () => {
      const json = '{"a": {"b": [1, 2]}, "c": true}';
      expect(extractCadreJson(wrap(json))).toEqual({ a: { b: [1, 2] }, c: true });
    });

    it('should parse strings with already-escaped quotes', () => {
      expect(extractCadreJson(wrap('{"title": "Fix \\"foo\\" bug"}'))).toEqual({
        title: 'Fix "foo" bug',
      });
    });
  });

  describe('no match scenarios', () => {
    it('should return null when no cadre-json block exists', () => {
      expect(extractCadreJson('No fenced block here')).toBeNull();
    });

    it('should return null for a plain json block', () => {
      expect(extractCadreJson('```json\n{"key":"value"}\n```')).toBeNull();
    });

    it('should return null for empty content', () => {
      expect(extractCadreJson('')).toBeNull();
    });
  });

  describe('recovery from unescaped quotes', () => {
    it('should recover a title containing unescaped double-quotes', () => {
      const raw = '{"title": "Fix the "foo" parser", "body": "ok"}';
      expect(extractCadreJson(wrap(raw))).toEqual({
        title: 'Fix the "foo" parser',
        body: 'ok',
      });
    });

    it('should recover multiple unescaped quotes in the same value', () => {
      const raw = '{"body": "Use "bar" instead of "baz""}';
      const result = extractCadreJson(wrap(raw));
      expect(result).toEqual({ body: 'Use "bar" instead of "baz"' });
    });
  });

  describe('unrecoverable JSON', () => {
    it('should return null for structurally broken JSON', () => {
      expect(extractCadreJson(wrap('{title: broken}'))).toBeNull();
    });

    it('should return null for an empty block', () => {
      expect(extractCadreJson(wrap(''))).toBeNull();
    });
  });

  describe('surrounding content', () => {
    it('should extract the block when surrounded by other text', () => {
      const content = `Here is some text.\n\`\`\`cadre-json\n{"ok": true}\n\`\`\`\nMore text after.`;
      expect(extractCadreJson(content)).toEqual({ ok: true });
    });
  });
});

describe('extractCadreJsonWithError (agent-runtime)', () => {
  it('should return parsed value and null parseError on success', () => {
    const result = extractCadreJsonWithError(wrap('{"key": "value"}'));
    expect(result.parsed).toEqual({ key: 'value' });
    expect(result.parseError).toBeNull();
  });

  it('should return null parsed and descriptive error when no block exists', () => {
    const result = extractCadreJsonWithError('No cadre-json block');
    expect(result.parsed).toBeNull();
    expect(result.parseError).toBe('No cadre-json block found');
  });

  it('should return a parse error message for malformed JSON', () => {
    const result = extractCadreJsonWithError(wrap('{ "title": "x", body: invalid }'));
    expect(result.parsed).toBeNull();
    expect(result.parseError).toBeTruthy();
    expect(typeof result.parseError).toBe('string');
  });

  it('should recover from unescaped quotes and return null parseError', () => {
    const raw = '{"title": "Fix the "foo" parser", "body": "ok"}';
    const result = extractCadreJsonWithError(wrap(raw));
    expect(result.parsed).toEqual({ title: 'Fix the "foo" parser', body: 'ok' });
    expect(result.parseError).toBeNull();
  });

  it('should return recovery error message when both parse attempts fail', () => {
    const result = extractCadreJsonWithError(wrap('{title: no quotes, broken}}'));
    expect(result.parsed).toBeNull();
    expect(result.parseError).toBeTruthy();
    expect(result.parseError!.length).toBeGreaterThan(0);
  });
});
