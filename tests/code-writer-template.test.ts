import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const TEMPLATE_PATH = resolve(__dirname, '../src/agents/templates/code-writer.md');

describe('code-writer.md template', () => {
  let content: string;
  let lines: string[];

  beforeAll(() => {
    content = readFileSync(TEMPLATE_PATH, 'utf-8');
    lines = content.split('\n');
  });

  it('should start with a # Code Writer heading', () => {
    expect(content).toMatch(/^# Code Writer/m);
  });

  it('should have at least 40 lines of content', () => {
    const nonEmptyLines = lines.filter((l) => l.trim().length > 0);
    expect(nonEmptyLines.length).toBeGreaterThanOrEqual(35);
  });

  describe('input contract', () => {
    it('should describe task ID as an input', () => {
      expect(content).toMatch(/[Tt]ask.?[Ii][Dd]|task identifier/i);
    });

    it('should describe task description as an input', () => {
      expect(content).toMatch(/[Tt]ask description|description/i);
    });

    it('should describe acceptance criteria as an input', () => {
      expect(content).toMatch(/[Aa]cceptance [Cc]riteria/);
    });

    it('should describe file list as an input', () => {
      expect(content).toMatch(/[Ff]ile list|[Ff]iles to modify|[Ff]ile list/i);
    });
  });

  describe('output contract', () => {
    it('should describe modified or created source files as output', () => {
      expect(content).toMatch(/[Mm]odified|[Cc]reated/);
    });

    it('should describe a result summary as output', () => {
      expect(content).toMatch(/[Rr]esult summary|result report/i);
    });

    it('should include the result summary markdown format with taskId', () => {
      expect(content).toMatch(/\{taskId\}|\{taskName\}/);
    });

    it('should describe Files Modified section in the result format', () => {
      expect(content).toMatch(/Files Modified/i);
    });

    it('should describe Files Created section in the result format', () => {
      expect(content).toMatch(/Files Created/i);
    });
  });

  describe('tool permissions', () => {
    it('should list view as a permitted tool', () => {
      expect(content).toMatch(/\bview\b/i);
    });

    it('should list edit as a permitted tool', () => {
      expect(content).toMatch(/\bedit\b/i);
    });

    it('should list create as a permitted tool', () => {
      expect(content).toMatch(/\bcreate\b/i);
    });

    it('should list bash as a permitted tool', () => {
      expect(content).toMatch(/\bbash\b/i);
    });
  });

  describe('background context section', () => {
    it('should have a Background context (read-only) section', () => {
      expect(content).toMatch(/## Background context \(read-only\)/i);
    });

    it('should document analysis.md as a conditionally provided input', () => {
      expect(content).toMatch(/analysis\.md.*conditionally provided|conditionally provided.*analysis\.md/is);
    });

    it('should document scout-report.md as a conditionally provided input', () => {
      expect(content).toMatch(/scout-report\.md.*conditionally provided|conditionally provided.*scout-report\.md/is);
    });

    it('should state that background context files are read-only', () => {
      expect(content).toMatch(/read-only/i);
    });
  });

  describe('style constraints', () => {
    it('should mention making minimal changes', () => {
      expect(content).toMatch(/minimal|smallest possible change/i);
    });

    it('should prohibit fixing unrelated code or bugs', () => {
      expect(content).toMatch(/unrelated/i);
    });

    it('should mention following existing code style or conventions', () => {
      expect(content).toMatch(/code style|conventions|naming conventions/i);
    });
  });
});
