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

  describe('background context section', () => {
    it('should have a Background context (read-only) section', () => {
      expect(content).toMatch(/## Background context \(read-only\)/i);
    });

    it('should document baseline-results.json as a conditionally provided input', () => {
      expect(content).toMatch(/baseline-results\.json.*conditionally provided|conditionally provided.*baseline-results\.json/is);
    });

    it('should state that background context file is read-only', () => {
      expect(content).toMatch(/read-only/i);
    });
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

  describe('dead-property detection', () => {
    it('should have a Dead-property Detection section heading', () => {
      expect(content).toMatch(/## Dead-property Detection/);
    });

    it('should instruct verifying properties on this or returned objects have read call-sites', () => {
      expect(content).toMatch(/properties assigned on `this` or on a returned/i);
    });

    it('should instruct flagging properties with no readers', () => {
      expect(content).toMatch(/flag.*property.*never read|written but.*never read/i);
    });
  });

  describe('singleton lifecycle check', () => {
    it('should have a Singleton Lifecycle Check section heading', () => {
      expect(content).toMatch(/## Singleton Lifecycle Check/);
    });

    it('should instruct verifying handles are used to serve requests', () => {
      expect(content).toMatch(/used to.*serve requests/i);
    });

    it('should instruct checking consumers do not independently spawn equivalent instances', () => {
      expect(content).toMatch(/consumers.*do.*not.*independently spawn/i);
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

  describe('agent file parity', () => {
    const AGENT_PATH = resolve(__dirname, '../.github/agents/integration-checker.agent.md');
    let agentContent: string;

    beforeAll(() => {
      agentContent = readFileSync(AGENT_PATH, 'utf-8');
    });

    it('should have a Dead-property Detection section in the agent file', () => {
      expect(agentContent).toMatch(/## Dead-property Detection/);
    });

    it('should have a Singleton Lifecycle Check section in the agent file', () => {
      expect(agentContent).toMatch(/## Singleton Lifecycle Check/);
    });

    it('should have matching Dead-property Detection content between template and agent file', () => {
      const extractSection = (text: string, heading: string): string => {
        const regex = new RegExp(`## ${heading}\\n([\\s\\S]*?)(?=\\n## |$)`);
        const match = text.match(regex);
        return match ? match[1].trim() : '';
      };
      const templateSection = extractSection(content, 'Dead-property Detection');
      const agentSection = extractSection(agentContent, 'Dead-property Detection');
      expect(agentSection).toBe(templateSection);
    });

    it('should have matching Singleton Lifecycle Check content between template and agent file', () => {
      const extractSection = (text: string, heading: string): string => {
        const regex = new RegExp(`## ${heading}\\n([\\s\\S]*?)(?=\\n## |$)`);
        const match = text.match(regex);
        return match ? match[1].trim() : '';
      };
      const templateSection = extractSection(content, 'Singleton Lifecycle Check');
      const agentSection = extractSection(agentContent, 'Singleton Lifecycle Check');
      expect(agentSection).toBe(templateSection);
    });
  });

  describe('section ordering', () => {
    it('should place Dead-property Detection after Baseline Comparison', () => {
      const baselineIdx = content.indexOf('## Baseline Comparison');
      const deadPropIdx = content.indexOf('## Dead-property Detection');
      expect(baselineIdx).toBeGreaterThan(-1);
      expect(deadPropIdx).toBeGreaterThan(baselineIdx);
    });

    it('should place Singleton Lifecycle Check after Dead-property Detection', () => {
      const deadPropIdx = content.indexOf('## Dead-property Detection');
      const singletonIdx = content.indexOf('## Singleton Lifecycle Check');
      expect(deadPropIdx).toBeGreaterThan(-1);
      expect(singletonIdx).toBeGreaterThan(deadPropIdx);
    });

    it('should place both new sections before the Output section', () => {
      const deadPropIdx = content.indexOf('## Dead-property Detection');
      const singletonIdx = content.indexOf('## Singleton Lifecycle Check');
      const outputIdx = content.indexOf('## Output');
      expect(deadPropIdx).toBeLessThan(outputIdx);
      expect(singletonIdx).toBeLessThan(outputIdx);
    });
  });
});
