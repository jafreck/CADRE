import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const TEMPLATE_PATH = resolve(__dirname, '../src/agents/templates/codebase-scout.md');
let content: string;
let lines: string[];

beforeAll(() => {
  content = readFileSync(TEMPLATE_PATH, 'utf-8');
  lines = content.split('\n');
});

describe('codebase-scout.md template', () => {
  it('should have a # Codebase Scout heading', () => {
    expect(content).toMatch(/^# Codebase Scout/m);
  });

  it('should have at least 40 lines of content', () => {
    expect(lines.length).toBeGreaterThanOrEqual(40);
  });

  describe('input contract', () => {
    it('should describe the analysis.md input file', () => {
      expect(content).toMatch(/analysis\.md/i);
    });

    it('should describe the inputFiles field', () => {
      expect(content).toMatch(/inputFiles/);
    });

    it('should describe the outputPath field', () => {
      expect(content).toMatch(/outputPath/);
    });

    it('should describe the worktreePath field', () => {
      expect(content).toMatch(/worktreePath/);
    });
  });

  describe('tool permissions', () => {
    it('should list glob as a permitted tool', () => {
      expect(content).toMatch(/\bglob\b/i);
    });

    it('should list grep as a permitted tool', () => {
      expect(content).toMatch(/\bgrep\b/i);
    });

    it('should list view as a permitted tool', () => {
      expect(content).toMatch(/\bview\b/i);
    });
  });

  describe('output contract', () => {
    it('should describe Relevant Files section', () => {
      expect(content).toMatch(/Relevant Files/i);
    });

    it('should describe Dependency Map section', () => {
      expect(content).toMatch(/Dependency Map/i);
    });

    it('should describe Test Files section', () => {
      expect(content).toMatch(/Test Files/i);
    });

    it('should describe Estimated Change Surface section', () => {
      expect(content).toMatch(/Estimated Change Surface/i);
    });

    it('should mention scout-report.md or output report', () => {
      expect(content).toMatch(/scout-report\.md|scout report/i);
    });
  });

  describe('example output', () => {
    it('should include at least one example output section', () => {
      expect(content).toMatch(/Example Output|example output/i);
    });

    it('example should contain a file table with File and Reason columns', () => {
      expect(content).toMatch(/\|\s*File\s*\|/);
      expect(content).toMatch(/\|\s*Reason\s*\|/);
    });
  });
});
