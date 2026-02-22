import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { AGENT_DEFINITIONS } from '../src/agents/types.js';

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
});
