import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const TEMPLATE_PATH = resolve(__dirname, '../src/agents/templates/test-writer.md');

describe('test-writer.md template', () => {
  let content: string;
  let lines: string[];

  beforeAll(() => {
    content = readFileSync(TEMPLATE_PATH, 'utf-8');
    lines = content.split('\n');
  });

  it('should start with a # Test Writer heading', () => {
    expect(lines[0].trim()).toBe('# Test Writer');
  });

  it('should have at least 30 lines of content', () => {
    const nonEmptyLines = lines.filter((l) => l.trim().length > 0);
    expect(nonEmptyLines.length).toBeGreaterThanOrEqual(30);
  });

  describe('input contract', () => {
    it('should describe task result as input', () => {
      expect(content).toMatch(/task result/i);
    });

    it('should describe changed source files as input', () => {
      expect(content).toMatch(/source file/i);
    });
  });

  describe('output contract', () => {
    it('should describe test files as output', () => {
      expect(content).toMatch(/test file/i);
    });

    it('should specify that tests must pass', () => {
      expect(content).toMatch(/pass/i);
    });
  });

  describe('tool permissions', () => {
    it('should mention view permission', () => {
      expect(content).toMatch(/\bview\b/i);
    });

    it('should mention edit permission', () => {
      expect(content).toMatch(/\bedit\b/i);
    });

    it('should mention create permission', () => {
      expect(content).toMatch(/\bcreate\b/i);
    });

    it('should mention bash permission', () => {
      expect(content).toMatch(/\bbash\b/i);
    });
  });

  describe('test framework guidance', () => {
    it('should specify Vitest as the test framework', () => {
      expect(content).toMatch(/[Vv]itest/);
    });

    it('should include vitest import example', () => {
      expect(content).toMatch(/from 'vitest'/);
    });
  });

  describe('test naming', () => {
    it('should describe describe block naming convention', () => {
      expect(content).toMatch(/describe/);
    });

    it('should describe it/test case naming with "should"', () => {
      expect(content).toMatch(/should/);
    });
  });

  describe('file placement', () => {
    it('should specify test file location under tests/', () => {
      expect(content).toMatch(/tests\//);
    });
  });

  describe('coverage goals', () => {
    it('should mention error paths or edge cases', () => {
      expect(content).toMatch(/error|edge.case/i);
    });

    it('should mention public API coverage', () => {
      expect(content).toMatch(/public API/i);
    });
  });

  describe('constraints', () => {
    it('should prohibit modifying source files', () => {
      expect(content).toMatch(/do not modify source/i);
    });
  });
});
