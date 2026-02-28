import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const TEMPLATE_PATH = resolve(__dirname, '../src/agents/templates/issue-analyst.md');

describe('issue-analyst.md template', () => {
  let content: string;
  let lines: string[];

  beforeAll(() => {
    content = readFileSync(TEMPLATE_PATH, 'utf-8');
    lines = content.split('\n');
  });

  it('should start with a # Issue Analyst heading', () => {
    expect(lines[0].trim()).toBe('# Issue Analyst');
  });

  it('should have at least 30 lines of content', () => {
    const nonEmptyLines = lines.filter((l) => l.trim().length > 0);
    expect(nonEmptyLines.length).toBeGreaterThanOrEqual(30);
  });

  describe('input contract', () => {
    it('should describe the issue number as input', () => {
      expect(content).toMatch(/issue number/i);
    });

    it('should describe repository context as input', () => {
      expect(content).toMatch(/repo(sitory)? context/i);
    });
  });

  describe('output contract', () => {
    it('should describe a Requirements output section', () => {
      expect(content).toMatch(/Requirements/i);
    });

    it('should describe a Change Type output section', () => {
      expect(content).toMatch(/Change Type/i);
    });

    it('should describe a Scope Estimate output section', () => {
      expect(content).toMatch(/Scope/i);
    });

    it('should describe an Affected Areas output section', () => {
      expect(content).toMatch(/Affected Areas/i);
    });

    it('should describe an Ambiguities output section', () => {
      expect(content).toMatch(/Ambiguit/i);
    });

    it('should instruct writing output to outputPath', () => {
      expect(content).toMatch(/outputPath/i);
      expect(content).toMatch(/write/i);
    });
  });

  describe('tool permissions', () => {
    it('should mention GitHub issue read permission', () => {
      expect(content).toMatch(/GitHub issue/i);
    });

    it('should mention code search permission', () => {
      expect(content).toMatch(/[Cc]ode search/);
    });
  });

  describe('example output', () => {
    it('should include at least one example output section', () => {
      expect(content).toMatch(/[Ee]xample/);
    });
  });
});
