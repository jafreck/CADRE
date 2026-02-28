import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import { BaseResultParser } from '../../../../packages/agent-runtime/src/output/result-parser.js';

vi.mock('node:fs/promises');

// Expose protected methods for testing
class TestableParser extends BaseResultParser {
  public unescapeText(text: string): string {
    return super.unescapeText(text);
  }

  public parseArtifact<T>(
    filePath: string,
    schema: z.ZodType<T>,
    agentDescription: string,
    transform?: (result: T) => T,
  ): Promise<T> {
    return super.parseArtifact(filePath, schema, agentDescription, transform);
  }
}

const simpleSchema = z.object({
  name: z.string(),
  value: z.number(),
});

describe('BaseResultParser', () => {
  let parser: TestableParser;

  beforeEach(() => {
    vi.clearAllMocks();
    parser = new TestableParser();
  });

  describe('unescapeText', () => {
    it('should replace literal \\n with real newlines', () => {
      expect(parser.unescapeText('hello\\nworld')).toBe('hello\nworld');
    });

    it('should replace literal \\t with real tabs', () => {
      expect(parser.unescapeText('col1\\tcol2')).toBe('col1\tcol2');
    });

    it('should remove literal \\r', () => {
      expect(parser.unescapeText('line\\r\\n')).toBe('line\n');
    });

    it('should handle multiple escape sequences in one string', () => {
      // \\r is stripped entirely (not converted to \r)
      expect(parser.unescapeText('a\\nb\\tc\\rd')).toBe('a\nb\tcd');
    });

    it('should return the original string when no escape sequences exist', () => {
      expect(parser.unescapeText('plain text')).toBe('plain text');
    });

    it('should handle empty string', () => {
      expect(parser.unescapeText('')).toBe('');
    });
  });

  describe('parseArtifact', () => {
    it('should parse valid cadre-json and validate against schema', async () => {
      const data = { name: 'test', value: 42 };
      const content = `\`\`\`cadre-json\n${JSON.stringify(data)}\n\`\`\``;
      vi.mocked(readFile).mockResolvedValue(content);

      const result = await parser.parseArtifact('/tmp/file.md', simpleSchema, 'test-agent');
      expect(result).toEqual({ name: 'test', value: 42 });
    });

    it('should apply transform when provided', async () => {
      const data = { name: 'hello\\nworld', value: 1 };
      const content = `\`\`\`cadre-json\n${JSON.stringify(data)}\n\`\`\``;
      vi.mocked(readFile).mockResolvedValue(content);

      const result = await parser.parseArtifact(
        '/tmp/file.md',
        simpleSchema,
        'test-agent',
        (r) => ({ ...r, name: parser.unescapeText(r.name) }),
      );
      expect(result.name).toBe('hello\nworld');
    });

    it('should throw when cadre-json block is missing', async () => {
      vi.mocked(readFile).mockResolvedValue('no block here');

      await expect(
        parser.parseArtifact('/tmp/file.md', simpleSchema, 'test-agent'),
      ).rejects.toThrow('cadre-json');
    });

    it('should include file path in error message', async () => {
      vi.mocked(readFile).mockResolvedValue('no block');

      await expect(
        parser.parseArtifact('/tmp/my-file.md', simpleSchema, 'test-agent'),
      ).rejects.toThrow('/tmp/my-file.md');
    });

    it('should include agent description in error message', async () => {
      vi.mocked(readFile).mockResolvedValue('no block');

      await expect(
        parser.parseArtifact('/tmp/file.md', simpleSchema, 'my-custom-agent'),
      ).rejects.toThrow('my-custom-agent');
    });

    it('should include parse error detail for malformed JSON', async () => {
      const content = '```cadre-json\n{ broken json }\n```';
      vi.mocked(readFile).mockResolvedValue(content);

      await expect(
        parser.parseArtifact('/tmp/file.md', simpleSchema, 'test-agent'),
      ).rejects.toThrow(/Parse error:/);
    });

    it('should throw ZodError when JSON is valid but fails schema validation', async () => {
      const data = { name: 123, value: 'not-a-number' };
      const content = `\`\`\`cadre-json\n${JSON.stringify(data)}\n\`\`\``;
      vi.mocked(readFile).mockResolvedValue(content);

      await expect(
        parser.parseArtifact('/tmp/file.md', simpleSchema, 'test-agent'),
      ).rejects.toThrow();
    });

    it('should work without a transform function', async () => {
      const data = { name: 'no-transform', value: 99 };
      const content = `\`\`\`cadre-json\n${JSON.stringify(data)}\n\`\`\``;
      vi.mocked(readFile).mockResolvedValue(content);

      const result = await parser.parseArtifact('/tmp/file.md', simpleSchema, 'test-agent');
      expect(result).toEqual(data);
    });

    it('should parse cadre-json block surrounded by other content', async () => {
      const data = { name: 'embedded', value: 7 };
      const content = `# Header\nSome text\n\`\`\`cadre-json\n${JSON.stringify(data)}\n\`\`\`\nMore text`;
      vi.mocked(readFile).mockResolvedValue(content);

      const result = await parser.parseArtifact('/tmp/file.md', simpleSchema, 'test-agent');
      expect(result).toEqual(data);
    });
  });
});
