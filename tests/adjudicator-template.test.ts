import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const TEMPLATE_PATH = resolve(__dirname, '../src/agents/templates/adjudicator.md');

describe('adjudicator.md template', () => {
  let content: string;
  let lines: string[];

  beforeAll(() => {
    content = readFileSync(TEMPLATE_PATH, 'utf-8');
    lines = content.split('\n');
  });

  it('should start with a # Adjudicator heading', () => {
    expect(lines[0].trim()).toBe('# Adjudicator');
  });

  it('should have at least 30 lines of content', () => {
    const nonEmptyLines = lines.filter((l) => l.trim().length > 0);
    expect(nonEmptyLines.length).toBeGreaterThanOrEqual(30);
  });

  describe('input contract', () => {
    it('should describe competing options as input', () => {
      expect(content).toMatch(/[Oo]ptions?/);
    });

    it('should describe context as input', () => {
      expect(content).toMatch(/[Cc]ontext/);
    });

    it('should describe constraints as input', () => {
      expect(content).toMatch(/[Cc]onstraints?/);
    });
  });

  describe('output contract', () => {
    it('should describe a selected option output', () => {
      expect(content).toMatch(/[Ss]elected [Oo]ption/);
    });

    it('should describe a rationale output section', () => {
      expect(content).toMatch(/[Rr]ationale/);
    });
  });

  describe('decision-making criteria', () => {
    it('should include decision-making criteria guidance', () => {
      expect(content).toMatch(/[Cc]riteria/);
    });

    it('should mention correctness as a criterion', () => {
      expect(content).toMatch(/[Cc]orrectness/);
    });

    it('should mention simplicity as a criterion', () => {
      expect(content).toMatch(/[Ss]implicit/);
    });
  });

  describe('tool permissions', () => {
    it('should mention read file permission', () => {
      expect(content).toMatch(/[Rr]ead files?/);
    });
  });

  describe('example output', () => {
    it('should include at least one example output section', () => {
      expect(content).toMatch(/[Ee]xample/);
    });
  });
});
