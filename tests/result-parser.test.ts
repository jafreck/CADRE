import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ZodError } from 'zod';
import { readFile } from 'node:fs/promises';
import { ResultParser } from '../src/agents/result-parser.js';
import { Logger } from '../src/logging/logger.js';

vi.mock('node:fs/promises');

describe('ResultParser', () => {
  let parser: ResultParser;
  let mockLogger: { debug: ReturnType<typeof vi.fn>; info: ReturnType<typeof vi.fn>; warn: ReturnType<typeof vi.fn>; error: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    mockLogger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };
    parser = new ResultParser(mockLogger as unknown as Logger);
  });

  describe('parseImplementationPlan', () => {
    it('should parse a well-formed implementation plan', async () => {
      const planContent = `# Implementation Plan: Issue #42

## Strategy
Fix the login timeout handling.

## Task Summary
- **Total Tasks**: 2

## Tasks

### Task: task-001 - Add timeout types

**Description:** Add TypeScript types for timeout config
**Files:** src/config/types.ts, src/config/schema.ts
**Dependencies:** none
**Complexity:** simple
**Acceptance Criteria:**
- TimeoutConfig interface defined
- Config validates positive integers

### Task: task-002 - Implement middleware

**Description:** Create timeout middleware
**Files:** src/middleware/timeout.ts
**Dependencies:** task-001
**Complexity:** moderate
**Acceptance Criteria:**
- Middleware times out after configured duration
- Returns 408 on timeout
`;
      vi.mocked(readFile).mockResolvedValue(planContent);

      const tasks = await parser.parseImplementationPlan('/tmp/plan.md');

      expect(tasks).toHaveLength(2);
      expect(tasks[0].id).toBe('task-001');
      expect(tasks[0].name).toBe('Add timeout types');
      expect(tasks[0].files).toContain('src/config/types.ts');
      expect(tasks[0].files).toContain('src/config/schema.ts');
      expect(tasks[0].dependencies).toEqual([]);
      expect(tasks[0].complexity).toBe('simple');
      expect(tasks[0].acceptanceCriteria).toHaveLength(2);

      expect(tasks[1].id).toBe('task-002');
      expect(tasks[1].dependencies).toEqual(['task-001']);
      expect(tasks[1].complexity).toBe('moderate');
    });

    it('should handle plan with no tasks', async () => {
      vi.mocked(readFile).mockResolvedValue('# Empty Plan\n\nNo tasks here.');

      const tasks = await parser.parseImplementationPlan('/tmp/plan.md');
      expect(tasks).toHaveLength(0);
    });

    it('should use cadre-json block when present and skip regex', async () => {
      const task = { id: 'task-001', name: 'My Task', description: 'Do stuff', files: ['src/foo.ts'], dependencies: [], complexity: 'simple', acceptanceCriteria: ['Does stuff'] };
      const content = `# Plan\n\n\`\`\`cadre-json\n${JSON.stringify([task])}\n\`\`\`\n`;
      vi.mocked(readFile).mockResolvedValue(content);

      const tasks = await parser.parseImplementationPlan('/tmp/plan.md');
      expect(tasks).toHaveLength(1);
      expect(tasks[0].id).toBe('task-001');
      expect(mockLogger.warn).not.toHaveBeenCalled();
    });

    it('should emit deprecation warn when falling back to regex parsing', async () => {
      vi.mocked(readFile).mockResolvedValue('# Plan\n\nNo cadre-json block here.');

      await parser.parseImplementationPlan('/tmp/plan.md');
      expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining('[deprecated]'));
      expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining('parseImplementationPlan'));
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
    it('should parse a passing review', async () => {
      const reviewContent = `# Code Review: task-001

## Verdict: pass

All acceptance criteria are met. Code is clean.

## Summary
The implementation looks correct and well-structured.
`;
      vi.mocked(readFile).mockResolvedValue(reviewContent);

      const result = await parser.parseReview('/tmp/review.md');
      expect(result.verdict).toBe('pass');
    });

    it('should parse a review that needs fixes', async () => {
      const reviewContent = `# Code Review: task-001

## Verdict: needs-fixes

## Issues
- **warning**: Missing null check in \`src/auth/login.ts\` at line 42

## Summary
One issue found that should be fixed.
`;
      vi.mocked(readFile).mockResolvedValue(reviewContent);

      const result = await parser.parseReview('/tmp/review.md');
      expect(result.verdict).toBe('needs-fixes');
    });

    it('should use cadre-json block for review when present', async () => {
      const review = { verdict: 'pass', issues: [], summary: 'Looks good' };
      const content = `\`\`\`cadre-json\n${JSON.stringify(review)}\n\`\`\``;
      vi.mocked(readFile).mockResolvedValue(content);

      const result = await parser.parseReview('/tmp/review.md');
      expect(result.verdict).toBe('pass');
      expect(result.summary).toBe('Looks good');
      expect(mockLogger.warn).not.toHaveBeenCalled();
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

    it('should emit deprecation warn for review regex fallback', async () => {
      vi.mocked(readFile).mockResolvedValue('## Verdict: pass\n\n## Summary\nok');

      await parser.parseReview('/tmp/review.md');
      expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining('[deprecated]'));
      expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining('parseReview'));
    });

    it('should throw ZodError for review cadre-json with invalid verdict', async () => {
      const invalid = { verdict: 'unknown', issues: [], summary: 'x' };
      const content = `\`\`\`cadre-json\n${JSON.stringify(invalid)}\n\`\`\``;
      vi.mocked(readFile).mockResolvedValue(content);

      await expect(parser.parseReview('/tmp/review.md')).rejects.toBeInstanceOf(ZodError);
    });
  });

  describe('parsePRContent', () => {
    it('should parse PR content with YAML frontmatter', async () => {
      const prContent = `---
title: "fix: resolve login timeout (#42)"
labels: ["bug", "cadre-generated"]
---

## Summary

Fixed the login timeout handling.

Closes #42
`;
      vi.mocked(readFile).mockResolvedValue(prContent);

      const result = await parser.parsePRContent('/tmp/pr-content.md');
      expect(result.title).toBe('fix: resolve login timeout (#42)');
      expect(result.labels).toContain('bug');
      expect(result.labels).toContain('cadre-generated');
      expect(result.body).toContain('Closes #42');
    });

    it('should handle PR content without frontmatter', async () => {
      vi.mocked(readFile).mockResolvedValue('Just a body\n\nWith some paragraphs.');

      const result = await parser.parsePRContent('/tmp/pr-content.md');
      expect(result.title).toBe('');
      expect(result.labels).toEqual([]);
      expect(result.body).toBe('Just a body\n\nWith some paragraphs.');
    });

    it('should use cadre-json block for PR content when present', async () => {
      const pr = { title: 'feat: add thing', body: 'Does something', labels: ['enhancement'] };
      const content = `\`\`\`cadre-json\n${JSON.stringify(pr)}\n\`\`\``;
      vi.mocked(readFile).mockResolvedValue(content);

      const result = await parser.parsePRContent('/tmp/pr-content.md');
      expect(result.title).toBe('feat: add thing');
      expect(result.labels).toContain('enhancement');
      expect(mockLogger.warn).not.toHaveBeenCalled();
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

    it('should emit deprecation warn for PR content regex fallback', async () => {
      vi.mocked(readFile).mockResolvedValue('Just a body');

      await parser.parsePRContent('/tmp/pr-content.md');
      expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining('[deprecated]'));
      expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining('parsePRContent'));
    });

    it('should throw ZodError for PR cadre-json missing required fields', async () => {
      const invalid = { title: 'x' }; // missing body and labels
      const content = `\`\`\`cadre-json\n${JSON.stringify(invalid)}\n\`\`\``;
      vi.mocked(readFile).mockResolvedValue(content);

      await expect(parser.parsePRContent('/tmp/pr-content.md')).rejects.toBeInstanceOf(ZodError);
    });
  });

  describe('parseAnalysis', () => {
    it('should parse a well-formed analysis', async () => {
      const analysisContent = `# Analysis: Issue #42

## Requirements
- Login handler should respect configured timeout
- Return 408 on timeout

## Change Type
bug fix

## Scope
medium

## Affected Areas
- Auth module: login handler
- Middleware: timeout configuration

## Ambiguities
- Should timeout be configurable per-route?
`;
      vi.mocked(readFile).mockResolvedValue(analysisContent);

      const result = await parser.parseAnalysis('/tmp/analysis.md');
      expect(result.requirements).toHaveLength(2);
      expect(result.changeType).toBe('bug-fix');
      expect(result.scope).toBe('medium');
      expect(result.affectedAreas).toHaveLength(2);
      expect(result.ambiguities).toHaveLength(1);
    });

    it('should use cadre-json block for analysis when present', async () => {
      const analysis = { requirements: ['req1'], changeType: 'feature', scope: 'small', affectedAreas: ['area1'], ambiguities: [] };
      const content = `\`\`\`cadre-json\n${JSON.stringify(analysis)}\n\`\`\``;
      vi.mocked(readFile).mockResolvedValue(content);

      const result = await parser.parseAnalysis('/tmp/analysis.md');
      expect(result.changeType).toBe('feature');
      expect(result.scope).toBe('small');
      expect(mockLogger.warn).not.toHaveBeenCalled();
    });

    it('should emit deprecation warn for analysis regex fallback', async () => {
      vi.mocked(readFile).mockResolvedValue('# Analysis\n\n## Requirements\n- Something');

      await parser.parseAnalysis('/tmp/analysis.md');
      expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining('[deprecated]'));
      expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining('parseAnalysis'));
    });

    it('should throw ZodError for analysis cadre-json with invalid changeType', async () => {
      const invalid = { requirements: [], changeType: 'invalid', scope: 'small', affectedAreas: [], ambiguities: [] };
      const content = `\`\`\`cadre-json\n${JSON.stringify(invalid)}\n\`\`\``;
      vi.mocked(readFile).mockResolvedValue(content);

      await expect(parser.parseAnalysis('/tmp/analysis.md')).rejects.toBeInstanceOf(ZodError);
    });
  });

  describe('parseScoutReport', () => {
    it('should parse relevant files from scout report', async () => {
      const reportContent = `# Scout Report: Issue #42

## Relevant Files
- \`src/auth/login.ts\` - Contains login handler
- \`src/middleware/timeout.ts\` - Timeout config

## Test Files
- \`src/auth/login.test.ts\`

## Estimated Changes
- **Total files**: 2
`;
      vi.mocked(readFile).mockResolvedValue(reportContent);

      const result = await parser.parseScoutReport('/tmp/scout.md');
      expect(result.relevantFiles).toHaveLength(2);
      expect(result.relevantFiles[0].path).toBe('src/auth/login.ts');
      expect(result.testFiles).toContain('src/auth/login.test.ts');
    });

    it('should use cadre-json block for scout report when present', async () => {
      const scout = { relevantFiles: [{ path: 'src/foo.ts', reason: 'core logic' }], dependencyMap: {}, testFiles: ['src/foo.test.ts'], estimatedChanges: [{ path: 'src/foo.ts', linesEstimate: 20 }] };
      const content = `\`\`\`cadre-json\n${JSON.stringify(scout)}\n\`\`\``;
      vi.mocked(readFile).mockResolvedValue(content);

      const result = await parser.parseScoutReport('/tmp/scout.md');
      expect(result.relevantFiles[0].path).toBe('src/foo.ts');
      expect(result.testFiles).toContain('src/foo.test.ts');
      expect(mockLogger.warn).not.toHaveBeenCalled();
    });

    it('should emit deprecation warn for scout report regex fallback', async () => {
      vi.mocked(readFile).mockResolvedValue('# Scout Report\n\n## Relevant Files\n- `src/a.ts` - reason');

      await parser.parseScoutReport('/tmp/scout.md');
      expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining('[deprecated]'));
      expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining('parseScoutReport'));
    });

    it('should throw ZodError for scout report cadre-json with invalid structure', async () => {
      const invalid = { relevantFiles: 'not-an-array' };
      const content = `\`\`\`cadre-json\n${JSON.stringify(invalid)}\n\`\`\``;
      vi.mocked(readFile).mockResolvedValue(content);

      await expect(parser.parseScoutReport('/tmp/scout.md')).rejects.toBeInstanceOf(ZodError);
    });
  });

  describe('parseIntegrationReport', () => {
    it('should parse passing integration report', async () => {
      const reportContent = `# Integration Report: Issue #42

## Build
**Command:** \`npm run build\`
**Exit Code:** 0
**Status:** pass

## Test
**Command:** \`npm test\`
**Exit Code:** 0
**Status:** pass

## Lint
**Command:** \`npm run lint\`
**Exit Code:** 0
**Status:** pass
`;
      vi.mocked(readFile).mockResolvedValue(reportContent);

      const result = await parser.parseIntegrationReport('/tmp/integration.md');
      expect(result.overallPass).toBe(true);
      expect(result.buildResult.pass).toBe(true);
      expect(result.testResult.pass).toBe(true);
    });

    it('should detect failing tests', async () => {
      const reportContent = `# Integration Report: Issue #42

## Build
**Command:** \`npm run build\`
**Exit Code:** 0
**Status:** pass

## Test
**Command:** \`npm test\`
**Exit Code:** 1
**Status:** fail
`;
      vi.mocked(readFile).mockResolvedValue(reportContent);

      const result = await parser.parseIntegrationReport('/tmp/integration.md');
      expect(result.overallPass).toBe(false);
      expect(result.testResult.pass).toBe(false);
    });

    it('should use cadre-json block for integration report when present', async () => {
      const report = {
        buildResult: { command: 'npm run build', exitCode: 0, output: '', pass: true },
        testResult: { command: 'npm test', exitCode: 0, output: '', pass: true },
        overallPass: true,
      };
      const content = `\`\`\`cadre-json\n${JSON.stringify(report)}\n\`\`\``;
      vi.mocked(readFile).mockResolvedValue(content);

      const result = await parser.parseIntegrationReport('/tmp/integration.md');
      expect(result.overallPass).toBe(true);
      expect(result.buildResult.command).toBe('npm run build');
      expect(mockLogger.warn).not.toHaveBeenCalled();
    });

    it('should emit deprecation warn for integration report regex fallback', async () => {
      vi.mocked(readFile).mockResolvedValue('# Integration Report\n\n## Build\n**Exit Code:** 0\n\n## Test\n**Exit Code:** 0');

      await parser.parseIntegrationReport('/tmp/integration.md');
      expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining('[deprecated]'));
      expect(mockLogger.warn).toHaveBeenCalledWith(expect.stringContaining('parseIntegrationReport'));
    });

    it('should throw ZodError for integration report cadre-json with invalid structure', async () => {
      const invalid = { overallPass: 'yes' }; // wrong type, missing required fields
      const content = `\`\`\`cadre-json\n${JSON.stringify(invalid)}\n\`\`\``;
      vi.mocked(readFile).mockResolvedValue(content);

      await expect(parser.parseIntegrationReport('/tmp/integration.md')).rejects.toBeInstanceOf(ZodError);
    });
  });
});
