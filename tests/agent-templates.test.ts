import { describe, it, expect, beforeAll } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { AGENT_DEFINITIONS } from '../src/agents/types.js';

const AGENT_DEFINITIONS_DIR = resolve(__dirname, '../.github/agents');

const TEMPLATES_DIR = resolve(__dirname, '../src/agents/templates');

describe('Agent Template Files', () => {
  describe('AGENT_DEFINITIONS templateFile entries', () => {
    it('should have 12 agent definitions', () => {
      expect(AGENT_DEFINITIONS).toHaveLength(12);
    });

    it('each templateFile should be a .md file', () => {
      for (const agent of AGENT_DEFINITIONS) {
        expect(agent.templateFile).toMatch(/\.md$/);
      }
    });

    it('each templateFile should exist in src/agents/templates/', () => {
      for (const agent of AGENT_DEFINITIONS) {
        const filePath = join(TEMPLATES_DIR, agent.templateFile);
        expect(existsSync(filePath), `Template missing: ${agent.templateFile}`).toBe(true);
      }
    });

    it('each template file should be non-empty', () => {
      for (const agent of AGENT_DEFINITIONS) {
        const filePath = join(TEMPLATES_DIR, agent.templateFile);
        if (existsSync(filePath)) {
          const content = readFileSync(filePath, 'utf-8').trim();
          expect(content.length, `Template empty: ${agent.templateFile}`).toBeGreaterThan(0);
        }
      }
    });

    it('each template file should contain a markdown heading', () => {
      for (const agent of AGENT_DEFINITIONS) {
        const filePath = join(TEMPLATES_DIR, agent.templateFile);
        if (existsSync(filePath)) {
          const content = readFileSync(filePath, 'utf-8');
          expect(content, `No heading in: ${agent.templateFile}`).toMatch(/^#\s+.+/m);
        }
      }
    });

    it('templateFile names should match agent name pattern', () => {
      for (const agent of AGENT_DEFINITIONS) {
        expect(agent.templateFile).toBe(`${agent.name}.md`);
      }
    });
  });

  describe('src/agents/templates/ directory', () => {
    it('should contain exactly 12 .md files', () => {
      const files = readdirSync(TEMPLATES_DIR).filter((f) => f.endsWith('.md'));
      expect(files).toHaveLength(12);
    });

    it('should not contain any non-.md files', () => {
      const files = readdirSync(TEMPLATES_DIR).filter((f) => !f.endsWith('.md'));
      expect(files).toHaveLength(0);
    });

    it('every .md file should correspond to an AGENT_DEFINITIONS entry', () => {
      const files = readdirSync(TEMPLATES_DIR).filter((f) => f.endsWith('.md'));
      const definedTemplateFiles = AGENT_DEFINITIONS.map((a) => a.templateFile);
      for (const file of files) {
        expect(definedTemplateFiles, `Unexpected template file: ${file}`).toContain(file);
      }
    });
  });

  describe('individual template content', () => {
    for (const agent of AGENT_DEFINITIONS) {
      it(`${agent.templateFile} should contain agent name or role content`, () => {
        const filePath = join(TEMPLATES_DIR, agent.templateFile);
        if (existsSync(filePath)) {
          const content = readFileSync(filePath, 'utf-8');
          // File should have at least one heading and some body content
          expect(content.split('\n').length).toBeGreaterThan(1);
        }
      });
    }
  });

  describe('pr-composer.md template content', () => {
    let content: string;

    beforeAll(() => {
      content = readFileSync(join(TEMPLATES_DIR, 'pr-composer.md'), 'utf-8');
    });

    it('should instruct writing a Summary section', () => {
      expect(content).toMatch(/##\s+Summary/i);
    });

    it('should instruct writing a Changes section', () => {
      expect(content).toMatch(/##\s+Changes/i);
    });

    it('should instruct writing a Testing section', () => {
      expect(content).toMatch(/##\s+Testing/i);
    });

    it('should mention payload.tokenSummary as the condition for Token Usage section', () => {
      expect(content).toContain('payload.tokenSummary');
    });

    it('should instruct appending a Token Usage section', () => {
      expect(content).toMatch(/##\s+Token Usage/i);
    });

    it('should instruct placing Token Usage at the end of the PR body', () => {
      // "end" or "last" should appear near the Token Usage instructions
      expect(content).toMatch(/end|last|after all/i);
    });

    it('should show total tokens in the Token Usage section', () => {
      expect(content).toMatch(/total\s*tokens/i);
    });

    it('should show estimated cost in the Token Usage section', () => {
      expect(content).toMatch(/estimatedCost|estimated\s*cost/i);
    });

    it('should describe a per-phase or per-agent breakdown', () => {
      expect(content).toMatch(/byPhase|byAgent|by phase|by agent|breakdown/i);
    });

    it('should instruct omitting Token Usage section when tokenSummary is absent', () => {
      expect(content).toMatch(/absent|omit|not.*present|only if/i);
    });

    it('should place Token Usage instructions after the standard sections', () => {
      const summaryIdx = content.indexOf('Summary');
      const changesIdx = content.indexOf('Changes');
      const testingIdx = content.indexOf('Testing');
      const tokenUsageIdx = content.indexOf('Token Usage');
      expect(tokenUsageIdx).toBeGreaterThan(summaryIdx);
      expect(tokenUsageIdx).toBeGreaterThan(changesIdx);
      expect(tokenUsageIdx).toBeGreaterThan(testingIdx);
    });
  });
});

describe('.github/agents/pr-composer.agent.md – Token Usage section', () => {
  let content: string;

  beforeAll(() => {
    content = readFileSync(join(AGENT_DEFINITIONS_DIR, 'pr-composer.agent.md'), 'utf-8');
  });

  it('should exist as a readable file', () => {
    expect(existsSync(join(AGENT_DEFINITIONS_DIR, 'pr-composer.agent.md'))).toBe(true);
  });

  it('should include a ## Token Usage section in its output format', () => {
    expect(content).toMatch(/##\s+Token Usage/i);
  });

  it('should reference totalTokens in the Token Usage section', () => {
    expect(content).toMatch(/totalTokens/);
  });

  it('should reference estimatedCost in the Token Usage section', () => {
    expect(content).toMatch(/estimatedCost/);
  });

  it('should reference the model field in the Token Usage section', () => {
    expect(content).toMatch(/\bmodel\b/i);
  });

  it('should mark the Token Usage section as conditional on tokenSummary presence', () => {
    expect(content).toMatch(/tokenSummary|if.*token|when.*token|absent|present/i);
  });

  it('should instruct omitting Token Usage when tokenSummary is absent', () => {
    expect(content).toMatch(/absent|omit|not.*present|only if/i);
  });

  it('should place Token Usage after the standard PR sections in the output format', () => {
    const summaryIdx = content.indexOf('Summary');
    const tokenUsageIdx = content.indexOf('Token Usage');
    expect(summaryIdx).toBeGreaterThanOrEqual(0);
    expect(tokenUsageIdx).toBeGreaterThan(summaryIdx);
  });
});
