import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ZodError } from 'zod';
import { readFile } from 'node:fs/promises';
import { ResultParser } from '../src/agents/result-parser.js';

vi.mock('node:fs/promises');

describe('ResultParser', () => {
  let parser: ResultParser;

  beforeEach(() => {
    parser = new ResultParser();
  });

  describe('parseImplementationPlan', () => {
    it('should parse tasks from a cadre-json block', async () => {
      const tasks = [
        { id: 'task-001', name: 'Add timeout types', description: 'Add TypeScript types for timeout config', files: ['src/config/types.ts', 'src/config/schema.ts'], dependencies: [], complexity: 'simple', acceptanceCriteria: ['TimeoutConfig interface defined', 'Config validates positive integers'] },
        { id: 'task-002', name: 'Implement middleware', description: 'Create timeout middleware', files: ['src/middleware/timeout.ts'], dependencies: ['task-001'], complexity: 'moderate', acceptanceCriteria: ['Middleware times out after configured duration', 'Returns 408 on timeout'] },
      ];
      const content = `# Plan\n\n\`\`\`cadre-json\n${JSON.stringify(tasks)}\n\`\`\`\n`;
      vi.mocked(readFile).mockResolvedValue(content);

      const result = await parser.parseImplementationPlan('/tmp/plan.md');

      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('task-001');
      expect(result[0].name).toBe('Add timeout types');
      expect(result[0].files).toContain('src/config/types.ts');
      expect(result[0].files).toContain('src/config/schema.ts');
      expect(result[0].dependencies).toEqual([]);
      expect(result[0].complexity).toBe('simple');
      expect(result[0].acceptanceCriteria).toHaveLength(2);
      expect(result[1].id).toBe('task-002');
      expect(result[1].dependencies).toEqual(['task-001']);
      expect(result[1].complexity).toBe('moderate');
    });

    it('should throw when cadre-json block is missing', async () => {
      vi.mocked(readFile).mockResolvedValue('# Plan\n\nNo cadre-json block here.');

      await expect(parser.parseImplementationPlan('/tmp/plan.md')).rejects.toThrow('cadre-json');
    });

    it('should throw ZodError when cadre-json block fails schema validation', async () => {
      const invalid = [{ id: 'task-001', name: 'Bad', complexity: 'invalid-level' }];
      const content = `\`\`\`cadre-json\n${JSON.stringify(invalid)}\n\`\`\``;
      vi.mocked(readFile).mockResolvedValue(content);

      await expect(parser.parseImplementationPlan('/tmp/plan.md')).rejects.toBeInstanceOf(ZodError);
    });

    it('should throw when cadre-json block contains invalid JSON', async () => {
      const content = '```cadre-json\n{ not valid json }\n```';
      vi.mocked(readFile).mockResolvedValue(content);

      await expect(parser.parseImplementationPlan('/tmp/plan.md')).rejects.toThrow(SyntaxError);
    });
  });

  describe('parseReview', () => {
    it('should parse a passing review from a cadre-json block', async () => {
      const review = { verdict: 'pass', issues: [], summary: 'Looks good' };
      const content = `\`\`\`cadre-json\n${JSON.stringify(review)}\n\`\`\``;
      vi.mocked(readFile).mockResolvedValue(content);

      const result = await parser.parseReview('/tmp/review.md');
      expect(result.verdict).toBe('pass');
      expect(result.summary).toBe('Looks good');
    });

    it('should parse a review that needs fixes from a cadre-json block', async () => {
      const review = { verdict: 'needs-fixes', issues: [{ file: 'src/auth/login.ts', line: 42, severity: 'warning', description: 'Missing null check' }], summary: 'One issue found' };
      const content = `\`\`\`cadre-json\n${JSON.stringify(review)}\n\`\`\``;
      vi.mocked(readFile).mockResolvedValue(content);

      const result = await parser.parseReview('/tmp/review.md');
      expect(result.verdict).toBe('needs-fixes');
      expect(result.issues).toHaveLength(1);
    });

    it('should normalize double-escaped newlines in cadre-json review summary', async () => {
      // Agents may write \\n instead of real newlines in summary/description fields.
      const summaryWithLiteralBackslashN = 'Good fix!\\nA few notes:\\n1. Point A\\n2. Point B';
      const review = { verdict: 'pass', issues: [], summary: summaryWithLiteralBackslashN };
      const content = `\`\`\`cadre-json\n${JSON.stringify(review)}\n\`\`\``;
      vi.mocked(readFile).mockResolvedValue(content);

      const result = await parser.parseReview('/tmp/review.md');
      expect(result.summary).toBe('Good fix!\nA few notes:\n1. Point A\n2. Point B');
      expect(result.summary).not.toContain('\\n');
    });

    it('should throw when cadre-json block is missing', async () => {
      vi.mocked(readFile).mockResolvedValue('## Verdict: pass\n\n## Summary\nok');

      await expect(parser.parseReview('/tmp/review.md')).rejects.toThrow('cadre-json');
    });

    it('should throw ZodError for review cadre-json with invalid verdict', async () => {
      const invalid = { verdict: 'unknown', issues: [], summary: 'x' };
      const content = `\`\`\`cadre-json\n${JSON.stringify(invalid)}\n\`\`\``;
      vi.mocked(readFile).mockResolvedValue(content);

      await expect(parser.parseReview('/tmp/review.md')).rejects.toBeInstanceOf(ZodError);
    });
  });

  describe('parsePRContent', () => {
    it('should parse PR content from a cadre-json block', async () => {
      const pr = { title: 'feat: add thing', body: 'Does something', labels: ['enhancement'] };
      const content = `\`\`\`cadre-json\n${JSON.stringify(pr)}\n\`\`\``;
      vi.mocked(readFile).mockResolvedValue(content);

      const result = await parser.parsePRContent('/tmp/pr-content.md');
      expect(result.title).toBe('feat: add thing');
      expect(result.labels).toContain('enhancement');
      expect(result.body).toBe('Does something');
    });

    it('should normalize double-escaped newlines in cadre-json body', async () => {
      // Agents sometimes write \\n instead of actual newlines in the JSON body,
      // producing a literal backslash-n sequence rather than a real line break.
      // Simulate this by starting with a string that has literal \n (two chars each):
      const bodyWithLiteralBackslashN = 'Good fix!\\n\\n1. Fix A\\n2. Fix B';
      //                                                ^^  ^^          ^^
      //  TypeScript \\n = one backslash + 'n' character (two chars, NOT a newline)
      const pr = { title: 'fix: something', body: bodyWithLiteralBackslashN, labels: [] };
      // JSON.stringify encodes each literal backslash as \\ in the JSON text,
      // so the cadre-json block contains \\n sequences.
      // extractCadreJson → JSON.parse decodes \\n to literal \n (backslash + n).
      // unescapeText must convert those back to real newline characters.
      const content = `\`\`\`cadre-json\n${JSON.stringify(pr)}\n\`\`\``;
      vi.mocked(readFile).mockResolvedValue(content);

      const result = await parser.parsePRContent('/tmp/pr-content.md');
      // Body must contain real newlines (0x0A), not the literal two-char "\n" sequence.
      expect(result.body).toBe('Good fix!\n\n1. Fix A\n2. Fix B');
      expect(result.body).not.toContain('\\n');
    });

    it('should throw when cadre-json block is missing', async () => {
      vi.mocked(readFile).mockResolvedValue('Just a body');

      await expect(parser.parsePRContent('/tmp/pr-content.md')).rejects.toThrow('cadre-json');
    });

    it('should throw ZodError for PR cadre-json missing required fields', async () => {
      const invalid = { title: 'x' }; // missing body and labels
      const content = `\`\`\`cadre-json\n${JSON.stringify(invalid)}\n\`\`\``;
      vi.mocked(readFile).mockResolvedValue(content);

      await expect(parser.parsePRContent('/tmp/pr-content.md')).rejects.toBeInstanceOf(ZodError);
    });
  });

  describe('parseAnalysis', () => {
    it('should parse analysis from a cadre-json block', async () => {
      const analysis = {
        requirements: ['Login handler should respect configured timeout', 'Return 408 on timeout'],
        changeType: 'bug-fix',
        scope: 'medium',
        affectedAreas: ['Auth module: login handler', 'Middleware: timeout configuration'],
        ambiguities: ['Should timeout be configurable per-route?'],
      };
      const content = `\`\`\`cadre-json\n${JSON.stringify(analysis)}\n\`\`\``;
      vi.mocked(readFile).mockResolvedValue(content);

      const result = await parser.parseAnalysis('/tmp/analysis.md');
      expect(result.requirements).toHaveLength(2);
      expect(result.changeType).toBe('bug-fix');
      expect(result.scope).toBe('medium');
      expect(result.affectedAreas).toHaveLength(2);
      expect(result.ambiguities).toHaveLength(1);
    });

    it('should throw when cadre-json block is missing', async () => {
      vi.mocked(readFile).mockResolvedValue('# Analysis\n\n## Requirements\n- Something');

      await expect(parser.parseAnalysis('/tmp/analysis.md')).rejects.toThrow('cadre-json');
    });

    it('should throw ZodError for analysis cadre-json with invalid changeType', async () => {
      const invalid = { requirements: [], changeType: 'invalid', scope: 'small', affectedAreas: [], ambiguities: [] };
      const content = `\`\`\`cadre-json\n${JSON.stringify(invalid)}\n\`\`\``;
      vi.mocked(readFile).mockResolvedValue(content);

      await expect(parser.parseAnalysis('/tmp/analysis.md')).rejects.toBeInstanceOf(ZodError);
    });
  });

  describe('parseScoutReport', () => {
    it('should parse scout report from a cadre-json block', async () => {
      const scout = {
        relevantFiles: [{ path: 'src/auth/login.ts', reason: 'Contains login handler' }, { path: 'src/middleware/timeout.ts', reason: 'Timeout config' }],
        dependencyMap: {},
        testFiles: ['src/auth/login.test.ts'],
        estimatedChanges: [{ path: 'src/auth/login.ts', linesEstimate: 30 }],
      };
      const content = `\`\`\`cadre-json\n${JSON.stringify(scout)}\n\`\`\``;
      vi.mocked(readFile).mockResolvedValue(content);

      const result = await parser.parseScoutReport('/tmp/scout.md');
      expect(result.relevantFiles).toHaveLength(2);
      expect(result.relevantFiles[0].path).toBe('src/auth/login.ts');
      expect(result.testFiles).toContain('src/auth/login.test.ts');
    });

    it('should throw when cadre-json block is missing', async () => {
      vi.mocked(readFile).mockResolvedValue('# Scout Report\n\n## Relevant Files\n- `src/a.ts` - reason');

      await expect(parser.parseScoutReport('/tmp/scout.md')).rejects.toThrow('cadre-json');
    });

    it('should throw ZodError for scout report cadre-json with invalid structure', async () => {
      const invalid = { relevantFiles: 'not-an-array' };
      const content = `\`\`\`cadre-json\n${JSON.stringify(invalid)}\n\`\`\``;
      vi.mocked(readFile).mockResolvedValue(content);

      await expect(parser.parseScoutReport('/tmp/scout.md')).rejects.toBeInstanceOf(ZodError);
    });
  });

  describe('parseIntegrationReport', () => {
    it('should parse a passing integration report from a cadre-json block', async () => {
      const report = {
        buildResult: { command: 'npm run build', exitCode: 0, output: '', pass: true },
        testResult: { command: 'npm test', exitCode: 0, output: '', pass: true },
        lintResult: { command: 'npm run lint', exitCode: 0, output: '', pass: true },
        overallPass: true,
      };
      const content = `\`\`\`cadre-json\n${JSON.stringify(report)}\n\`\`\``;
      vi.mocked(readFile).mockResolvedValue(content);

      const result = await parser.parseIntegrationReport('/tmp/integration.md');
      expect(result.overallPass).toBe(true);
      expect(result.buildResult.pass).toBe(true);
      expect(result.testResult.pass).toBe(true);
      expect(result.buildResult.command).toBe('npm run build');
    });

    it('should parse a failing integration report from a cadre-json block', async () => {
      const report = {
        buildResult: { command: 'npm run build', exitCode: 0, output: '', pass: true },
        testResult: { command: 'npm test', exitCode: 1, output: 'FAIL', pass: false },
        overallPass: false,
      };
      const content = `\`\`\`cadre-json\n${JSON.stringify(report)}\n\`\`\``;
      vi.mocked(readFile).mockResolvedValue(content);

      const result = await parser.parseIntegrationReport('/tmp/integration.md');
      expect(result.overallPass).toBe(false);
      expect(result.testResult.pass).toBe(false);
    });

    it('should throw when cadre-json block is missing', async () => {
      vi.mocked(readFile).mockResolvedValue('# Integration Report\n\n## Build\n**Exit Code:** 0\n\n## Test\n**Exit Code:** 0');

      await expect(parser.parseIntegrationReport('/tmp/integration.md')).rejects.toThrow('cadre-json');
    });

    it('should throw ZodError for integration report cadre-json with invalid structure', async () => {
      const invalid = { overallPass: 'yes' }; // wrong type, missing required fields
      const content = `\`\`\`cadre-json\n${JSON.stringify(invalid)}\n\`\`\``;
      vi.mocked(readFile).mockResolvedValue(content);

      await expect(parser.parseIntegrationReport('/tmp/integration.md')).rejects.toBeInstanceOf(ZodError);
    });
  });
});
