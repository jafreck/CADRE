import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(resolve(__dirname, '../package.json'), 'utf8'));
const DIST_TEMPLATES_DIR = resolve(__dirname, '../dist/agents/templates');

const EXPECTED_TEMPLATES = [
  'adjudicator.md',
  'code-reviewer.md',
  'code-writer.md',
  'codebase-scout.md',
  'conflict-resolver.md',
  'dep-conflict-resolver.md',
  'dependency-analyst.md',
  'fix-surgeon.md',
  'implementation-planner.md',
  'integration-checker.md',
  'issue-analyst.md',
  'pr-composer.md',
  'test-writer.md',
  'whole-pr-reviewer.md',
];

describe('package.json postbuild script', () => {
  it('should have a postbuild script', () => {
    expect(pkg.scripts).toBeDefined();
    expect(pkg.scripts.postbuild).toBeDefined();
    expect(typeof pkg.scripts.postbuild).toBe('string');
  });

  it('should reference src/agents/templates in postbuild script', () => {
    expect(pkg.scripts.postbuild).toContain('src/agents/templates');
  });

  it('should reference dist/agents/templates in postbuild script', () => {
    expect(pkg.scripts.postbuild).toContain('dist/agents/templates');
  });

  it('should use a copy command in postbuild script', () => {
    expect(pkg.scripts.postbuild).toMatch(/cp\s/);
  });
});

describe('dist/agents/templates/ after build', () => {
  it('dist/agents/templates/ directory should exist', () => {
    expect(existsSync(DIST_TEMPLATES_DIR)).toBe(true);
  });

  it.skipIf(!existsSync(DIST_TEMPLATES_DIR))('should contain exactly 14 .md template files', () => {
    const files = readdirSync(DIST_TEMPLATES_DIR).filter((f) => f.endsWith('.md'));
    expect(files).toHaveLength(14);
  });

  it.each(EXPECTED_TEMPLATES)('%s should be present in dist/agents/templates/', (template) => {
    if (!existsSync(DIST_TEMPLATES_DIR)) return;
    expect(existsSync(join(DIST_TEMPLATES_DIR, template))).toBe(true);
  });

  it.skipIf(!existsSync(DIST_TEMPLATES_DIR))('each copied template should be non-empty', () => {
    for (const template of EXPECTED_TEMPLATES) {
      const filePath = join(DIST_TEMPLATES_DIR, template);
      if (existsSync(filePath)) {
        const content = readFileSync(filePath, 'utf-8').trim();
        expect(content.length, `Template empty in dist: ${template}`).toBeGreaterThan(0);
      }
    }
  });

  it.skipIf(!existsSync(DIST_TEMPLATES_DIR))('should not contain any non-.md files', () => {
    const nonMd = readdirSync(DIST_TEMPLATES_DIR).filter((f) => !f.endsWith('.md'));
    expect(nonMd).toHaveLength(0);
  });
});
