import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFile } from 'node:fs/promises';
import { ResultParser } from '../src/agents/result-parser.js';
import { Logger } from '../src/logging/logger.js';

vi.mock('node:fs/promises');

describe('ResultParser', () => {
  let parser: ResultParser;

  beforeEach(() => {
    const mockLogger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    } as unknown as Logger;
    parser = new ResultParser(mockLogger);
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
  });
});
