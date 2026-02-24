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

    it('should describe session IDs with session-XXX pattern', () => {
      expect(content).toMatch(/session-\d{3}|session-XXX/i);
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

    it('should specify session and step schema fields', () => {
      expect(content).toMatch(/rationale/i);
      expect(content).toMatch(/steps/i);
      expect(content).toMatch(/sessionId|session-001/i);
    });
  });

  describe('rules section', () => {
    it('should contain a Rules section', () => {
      expect(content).toMatch(/###?\s*Rules/);
    });

    it('should require the agent to read source files before referencing them', () => {
      expect(content).toMatch(/MUST read every source file/);
    });

    it('should state the file-read rule applies before making claims about contents or structure', () => {
      expect(content).toMatch(/before making any claims about its contents or structure/);
    });
  });

  describe('tool permissions', () => {
    it('should mention read files permission', () => {
      expect(content).toMatch(/[Rr]ead files?/);
    });

    it('should mark reading source files as required', () => {
      expect(content).toMatch(/[Rr]ead.*required/);
    });

    it('should require reading source files before referencing them in tool permissions', () => {
      expect(content).toMatch(/source file.*reference|reference.*source file/);
    });
  });

  describe('example task block', () => {
    it('should include at least one example task block', () => {
      expect(content).toMatch(/[Ee]xample/);
    });

    it('example should contain a session-001 id', () => {
      expect(content).toMatch(/session-001/);
    });

    it('example should include rationale, steps, complexity, and acceptanceCriteria fields', () => {
      expect(content).toMatch(/"rationale"/);
      expect(content).toMatch(/"steps"/);
      expect(content).toMatch(/"complexity"/);
      expect(content).toMatch(/"acceptanceCriteria"/);
    });

    it('example should include at least one test file path in a files list', () => {
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
