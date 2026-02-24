import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const TEMPLATE_PATH = resolve(__dirname, '../src/agents/templates/pr-composer.md');

describe('pr-composer.md template', () => {
  let content: string;
  let lines: string[];

  beforeAll(() => {
    content = readFileSync(TEMPLATE_PATH, 'utf-8');
    lines = content.split('\n');
  });

  it('should start with a # PR Composer heading', () => {
    expect(lines[0].trim()).toBe('# PR Composer');
  });

  it('should have at least 30 lines of content', () => {
    const nonEmptyLines = lines.filter((l) => l.trim().length > 0);
    expect(nonEmptyLines.length).toBeGreaterThanOrEqual(30);
  });

  describe('input contract', () => {
    it('should describe the issue number as input', () => {
      expect(content).toMatch(/issue number/i);
    });

    it('should describe task summaries as input', () => {
      expect(content).toMatch(/task summar/i);
    });

    it('should describe changed files as input', () => {
      expect(content).toMatch(/changed files/i);
    });
  });

  describe('output contract', () => {
    it('should describe writing pr-content.md at the outputPath', () => {
      expect(content).toMatch(/pr-content\.md/);
    });

    it('should describe a title field', () => {
      expect(content).toMatch(/"title"/);
    });

    it('should describe a body field', () => {
      expect(content).toMatch(/"body"/);
    });

    it('should describe a labels field', () => {
      expect(content).toMatch(/"labels"/);
    });

    it('should describe the PR body structure with Summary section', () => {
      expect(content).toMatch(/Summary/i);
    });

    it('should describe the PR body structure with Changes section', () => {
      expect(content).toMatch(/Changes/i);
    });

    it('should describe the PR body structure with Testing section', () => {
      expect(content).toMatch(/Testing/i);
    });
  });

  describe('tool permissions', () => {
    it('should mention view or read file permission', () => {
      expect(content).toMatch(/\bview\b/i);
    });

    it('should mention bash or git permission', () => {
      expect(content).toMatch(/bash|git/i);
    });
  });

  describe('style constraints', () => {
    it('should mention imperative mood for the title', () => {
      expect(content).toMatch(/imperative/i);
    });

    it('should mention a title length limit', () => {
      expect(content).toMatch(/50/);
    });

    it('should mention GitHub Flavored Markdown', () => {
      expect(content).toMatch(/GitHub Flavored Markdown/i);
    });
  });
});
