import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const TEMPLATE_PATH = resolve(__dirname, '../src/agents/templates/code-reviewer.md');

describe('code-reviewer.md template', () => {
  let content: string;
  let lines: string[];

  beforeAll(() => {
    content = readFileSync(TEMPLATE_PATH, 'utf-8');
    lines = content.split('\n');
  });

  it('should start with a # Code Reviewer heading', () => {
    expect(content).toMatch(/^# Code Reviewer/m);
  });

  it('should have at least 30 lines of content', () => {
    const nonEmptyLines = lines.filter((l) => l.trim().length > 0);
    expect(nonEmptyLines.length).toBeGreaterThanOrEqual(30);
  });

  describe('input contract', () => {
    it('should describe a diff or changed files as input', () => {
      expect(content).toMatch(/diff|changed files?/i);
    });

    it('should mention available tools for investigation', () => {
      expect(content).toMatch(/\bview\b|\bgrep\b|git diff/i);
    });
  });

  describe('output contract', () => {
    it('should describe verdict as pass or needs-fixes', () => {
      expect(content).toMatch(/pass/);
      expect(content).toMatch(/needs-fixes/);
    });

    it('should describe an issues array in the output', () => {
      expect(content).toMatch(/issues/i);
    });

    it('should describe file field in issues', () => {
      expect(content).toMatch(/"file"/);
    });

    it('should describe severity field in issues', () => {
      expect(content).toMatch(/"severity"/);
    });

    it('should describe description field in issues', () => {
      expect(content).toMatch(/"description"/);
    });

    it('should describe line as an optional field', () => {
      expect(content).toMatch(/line/i);
    });

    it('should describe a summary field', () => {
      expect(content).toMatch(/"summary"/);
    });

    it('should describe severity values error and warning', () => {
      expect(content).toMatch(/error/);
      expect(content).toMatch(/warning/);
    });
  });

  describe('review criteria', () => {
    it('should specify that bugs warrant needs-fixes', () => {
      expect(content).toMatch(/[Bb]ug/);
    });

    it('should specify that security vulnerabilities warrant needs-fixes', () => {
      expect(content).toMatch(/[Ss]ecurity/);
    });

    it('should specify that logic errors warrant needs-fixes', () => {
      expect(content).toMatch(/[Ll]ogic error/);
    });

    it('should explicitly exclude style and formatting from needs-fixes', () => {
      expect(content).toMatch(/style|formatting/i);
      expect(content).toMatch(/not|do not|don't/i);
    });

    it('should explicitly exclude naming conventions from needs-fixes', () => {
      expect(content).toMatch(/[Nn]aming conventions?/);
    });
  });

  describe('ReviewResult interface compliance', () => {
    it('should show verdict field in JSON output', () => {
      expect(content).toMatch(/"verdict"/);
    });

    it('should show a cadre-json code block example', () => {
      expect(content).toMatch(/```cadre-json/);
    });
  });
});
