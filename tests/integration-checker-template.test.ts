import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const TEMPLATE_PATH = resolve(__dirname, '../src/agents/templates/integration-checker.md');

describe('integration-checker.md template', () => {
  let content: string;
  let lines: string[];

  beforeAll(() => {
    content = readFileSync(TEMPLATE_PATH, 'utf-8');
    lines = content.split('\n');
  });

  it('should start with a # Integration Checker heading', () => {
    expect(content).toMatch(/^# Integration Checker/m);
  });

  it('should have at least 30 non-empty lines of content', () => {
    const nonEmptyLines = lines.filter((l) => l.trim().length > 0);
    expect(nonEmptyLines.length).toBeGreaterThanOrEqual(30);
  });

  describe('input contract', () => {
    it('should describe commands from config as input', () => {
      expect(content).toMatch(/commands|config/i);
    });

    it('should mention install command', () => {
      expect(content).toMatch(/install/i);
    });

    it('should mention build command', () => {
      expect(content).toMatch(/build/i);
    });

    it('should mention test command', () => {
      expect(content).toMatch(/test/i);
    });

    it('should mention optional lint command', () => {
      expect(content).toMatch(/lint/i);
    });
  });

  describe('commands to run', () => {
    it('should specify npm install', () => {
      expect(content).toMatch(/npm install/);
    });

    it('should specify npm run build', () => {
      expect(content).toMatch(/npm run build/);
    });

    it('should specify npx vitest run', () => {
      expect(content).toMatch(/npx vitest run/);
    });
  });

  describe('exit code interpretation', () => {
    it('should explain that exit code 0 means success', () => {
      expect(content).toMatch(/exit code.{0,10}0/i);
    });

    it('should explain that non-zero exit codes mean failure', () => {
      expect(content).toMatch(/non.?zero|failure|fail/i);
    });
  });

  describe('output contract', () => {
    it('should describe IntegrationReport as the output structure', () => {
      expect(content).toMatch(/IntegrationReport/);
    });

    it('should include buildResult in the output', () => {
      expect(content).toMatch(/buildResult/);
    });

    it('should include testResult in the output', () => {
      expect(content).toMatch(/testResult/);
    });

    it('should include lintResult in the output', () => {
      expect(content).toMatch(/lintResult/);
    });

    it('should include overallPass in the output', () => {
      expect(content).toMatch(/overallPass/);
    });

    it('should include summary in the output', () => {
      expect(content).toMatch(/summary/i);
    });

    it('should specify overallPass is true only when all steps pass', () => {
      expect(content).toMatch(/overallPass.+true|all.+pass/is);
    });

    it('should allow lintResult to be null when no lint command is configured', () => {
      expect(content).toMatch(/null|optional/i);
    });
  });

  describe('baseline comparison', () => {
    it('should reference baseline-results.json', () => {
      expect(content).toMatch(/baseline-results\.json/);
    });

    it('should describe baselineFailures field', () => {
      expect(content).toMatch(/baselineFailures/);
    });

    it('should describe regressionFailures field', () => {
      expect(content).toMatch(/regressionFailures/);
    });

    it('should define overallPass in terms of regressions', () => {
      expect(content).toMatch(/overallPass.+regression|regression.+overallPass/is);
    });
  });

  describe('tool permissions', () => {
    it('should mention bash as a permitted tool', () => {
      expect(content).toMatch(/\bbash\b/i);
    });
  });
});
