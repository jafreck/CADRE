import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const TEMPLATE_PATH = resolve(__dirname, '../src/agents/templates/cadre-runner.md');
let content: string;
let lines: string[];

beforeAll(() => {
  content = readFileSync(TEMPLATE_PATH, 'utf-8');
  lines = content.split('\n');
});

describe('cadre-runner.md template', () => {
  it('should have a # CADRE Runner heading', () => {
    expect(content).toMatch(/^# CADRE Runner/m);
  });

  it('should have at least 40 lines of content', () => {
    expect(lines.length).toBeGreaterThanOrEqual(40);
  });

  describe('pipeline phases', () => {
    it('should describe Phase 1 (Analysis & Scouting)', () => {
      expect(content).toMatch(/Phase\s+1/i);
      expect(content).toMatch(/Analysis|Scouting/i);
    });

    it('should describe Phase 2 (Planning)', () => {
      expect(content).toMatch(/Phase\s+2/i);
      expect(content).toMatch(/Planning/i);
    });

    it('should describe Phase 3 (Implementation)', () => {
      expect(content).toMatch(/Phase\s+3/i);
      expect(content).toMatch(/Implementation/i);
    });

    it('should describe Phase 4 (Integration Verification)', () => {
      expect(content).toMatch(/Phase\s+4/i);
      expect(content).toMatch(/Integration|Verification/i);
    });

    it('should describe Phase 5 (PR Composition)', () => {
      expect(content).toMatch(/Phase\s+5/i);
      expect(content).toMatch(/PR|Pull Request|Composition/i);
    });

    it('should mention agents participating in Phase 1', () => {
      expect(content).toMatch(/issue-analyst/i);
      expect(content).toMatch(/codebase-scout/i);
    });

    it('should mention agents participating in Phase 3', () => {
      expect(content).toMatch(/code-writer/i);
      expect(content).toMatch(/test-writer/i);
    });
  });

  describe('context file convention', () => {
    it('should mention context file or context files', () => {
      expect(content).toMatch(/context file/i);
    });

    it('should describe the worktreePath field', () => {
      expect(content).toMatch(/worktreePath/);
    });

    it('should describe the inputFiles field', () => {
      expect(content).toMatch(/inputFiles/);
    });

    it('should describe the outputPath field', () => {
      expect(content).toMatch(/outputPath/);
    });
  });

  describe('output file convention', () => {
    it('should mention output file or output files', () => {
      expect(content).toMatch(/output file/i);
    });
  });

  describe('worktree isolation', () => {
    it('should describe worktree isolation or per-issue worktrees', () => {
      expect(content).toMatch(/worktree/i);
    });
  });
});
