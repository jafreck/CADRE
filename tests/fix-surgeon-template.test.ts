import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const TEMPLATE_PATH = resolve(__dirname, '../src/agents/templates/fix-surgeon.md');

describe('fix-surgeon.md template', () => {
  let content: string;
  let lines: string[];

  beforeAll(() => {
    content = readFileSync(TEMPLATE_PATH, 'utf-8');
    lines = content.split('\n');
  });

  it('should start with a # Fix Surgeon heading', () => {
    expect(content).toMatch(/^# Fix Surgeon/m);
  });

  it('should have at least 35 non-empty lines of content', () => {
    const nonEmptyLines = lines.filter((l) => l.trim().length > 0);
    expect(nonEmptyLines.length).toBeGreaterThanOrEqual(35);
  });

  describe('input contract', () => {
    it('should describe review issues as an input', () => {
      expect(content).toMatch(/[Rr]eview issues?/);
    });

    it('should describe source files as an input', () => {
      expect(content).toMatch(/[Ss]ource files?/);
    });

    it('should mention scout report as background context', () => {
      expect(content).toMatch(/[Ss]cout report/);
    });

    it('should have a Background context (read-only) section', () => {
      expect(content).toMatch(/## Background context \(read-only\)/i);
    });

    it('should document analysis.md as a conditionally provided input', () => {
      expect(content).toMatch(/analysis\.md.*conditionally provided|conditionally provided.*analysis\.md/is);
    });

    it('should document scout-report.md as a conditionally provided input', () => {
      expect(content).toMatch(/scout-report\.md.*conditionally provided|conditionally provided.*scout-report\.md/is);
    });

    it('should document the session plan or implementation-plan.md as a conditionally provided input', () => {
      expect(content).toMatch(/implementation-plan\.md.*conditionally provided|conditionally provided.*implementation-plan\.md/is);
    });

    it('should state that background context files are read-only', () => {
      expect(content).toMatch(/read-only/i);
    });
  });

  describe('output contract', () => {
    it('should describe fixed source files as output', () => {
      expect(content).toMatch(/[Ff]ixed source files?/);
    });

    it('should describe a fix summary as output', () => {
      expect(content).toMatch(/[Ff]ix summary/);
    });

    it('should include a Files Modified section in the fix summary format', () => {
      expect(content).toMatch(/Files Modified/);
    });

    it('should include a Files Created section in the fix summary format', () => {
      expect(content).toMatch(/Files Created/);
    });
  });

  describe('tool permissions', () => {
    it('should list view as a permitted tool', () => {
      expect(content).toMatch(/\bview\b/i);
    });

    it('should list edit as a permitted tool', () => {
      expect(content).toMatch(/\bedit\b/i);
    });

    it('should list bash as a permitted tool', () => {
      expect(content).toMatch(/\bbash\b/i);
    });
  });

  describe('style constraints', () => {
    it('should emphasize fixing only what is flagged', () => {
      expect(content).toMatch(/only.*flagged|fix only|explicitly flagged/i);
    });

    it('should prohibit refactoring or reformatting unrelated code', () => {
      expect(content).toMatch(/refactor|unrelated/i);
    });

    it('should mention making minimal or smallest possible changes', () => {
      expect(content).toMatch(/minimal|smallest possible change/i);
    });
  });
});
