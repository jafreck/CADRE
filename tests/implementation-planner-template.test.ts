import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const TEMPLATE_PATH = resolve(__dirname, '../src/agents/templates/implementation-planner.md');

describe('implementation-planner.md template', () => {
  let content: string;
  let lines: string[];

  beforeAll(() => {
    content = readFileSync(TEMPLATE_PATH, 'utf-8');
    lines = content.split('\n');
  });

  it('should start with a # Implementation Planner heading', () => {
    expect(content).toMatch(/^# Implementation Planner/m);
  });

  it('should have at least 40 lines of content', () => {
    const nonEmptyLines = lines.filter((l) => l.trim().length > 0);
    expect(nonEmptyLines.length).toBeGreaterThanOrEqual(40);
  });

  describe('input contract', () => {
    it('should describe analysis.md as an input file', () => {
      expect(content).toMatch(/analysis\.md/i);
    });

    it('should describe scout-report.md as an input file', () => {
      expect(content).toMatch(/scout-report\.md/i);
    });
  });

  describe('output contract', () => {
    it('should describe implementation-plan.md as the output file', () => {
      expect(content).toMatch(/implementation-plan\.md/i);
    });

    it('should describe task IDs with task-XXX pattern', () => {
      expect(content).toMatch(/task-\d{3}|task-XXX/i);
    });

    it('should describe dependencies field', () => {
      expect(content).toMatch(/[Dd]ependenc/);
    });

    it('should describe complexity field', () => {
      expect(content).toMatch(/[Cc]omplexity/);
    });

    it('should describe acceptance criteria field', () => {
      expect(content).toMatch(/[Aa]cceptance [Cc]riteria/);
    });

    it('should specify the exact ImplementationTask interface fields', () => {
      expect(content).toMatch(/\*\*Description:\*\*|\*\*Description\*\*:|\bDescription:/);
      expect(content).toMatch(/\*\*Files:\*\*|\*\*Files\*\*:|\bFiles:/);
      expect(content).toMatch(/\*\*Dependencies:\*\*|\*\*Dependencies\*\*:|\bDependencies:/);
      expect(content).toMatch(/\*\*Complexity:\*\*|\*\*Complexity\*\*:|\bComplexity:/);
    });
  });

  describe('tool permissions', () => {
    it('should mention read files permission', () => {
      expect(content).toMatch(/[Rr]ead files?/);
    });
  });

  describe('example task block', () => {
    it('should include at least one example task block', () => {
      expect(content).toMatch(/[Ee]xample/);
    });

    it('example should contain a task-001 heading', () => {
      expect(content).toMatch(/task-001/);
    });

    it('example should include Description, Files, Dependencies, Complexity, and Acceptance Criteria', () => {
      expect(content).toMatch(/\*\*Description:\*\*|\*\*Description\*\*:/);
      expect(content).toMatch(/\*\*Files:\*\*|\*\*Files\*\*:/);
      expect(content).toMatch(/\*\*Dependencies:\*\*|\*\*Dependencies\*\*:/);
      expect(content).toMatch(/\*\*Complexity:\*\*|\*\*Complexity\*\*:/);
      expect(content).toMatch(/\*\*Acceptance Criteria:\*\*|\*\*Acceptance Criteria\*\*:/);
    });

    it('example should include at least one test file path in a Files list', () => {
      expect(content).toMatch(/tests\/[^\s,]+\.test\.ts/);
    });
  });

  describe('test file inclusion rule', () => {
    it('should explicitly instruct that test files must be listed in the files array', () => {
      expect(content).toMatch(/test file/i);
    });

    it('should reference tests/*.test.ts pattern or equivalent in the rules', () => {
      expect(content).toMatch(/tests\/\*\.test\.ts|tests\/.*\.test\.ts/);
    });

    it('should clarify that files includes test files, not just source files', () => {
      expect(content).toMatch(/not just source files|test files.*creates or modifies|creates or modifies.*test/i);
    });
  });
});
