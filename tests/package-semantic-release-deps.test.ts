import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(resolve(__dirname, '../package.json'), 'utf8'));

describe('package.json semantic-release devDependencies', () => {
  it('should have a devDependencies field', () => {
    expect(pkg.devDependencies).toBeDefined();
  });

  it('should include semantic-release in devDependencies', () => {
    expect(pkg.devDependencies['semantic-release']).toBeDefined();
  });

  it('should include @semantic-release/changelog in devDependencies', () => {
    expect(pkg.devDependencies['@semantic-release/changelog']).toBeDefined();
  });

  it('should include @semantic-release/git in devDependencies', () => {
    expect(pkg.devDependencies['@semantic-release/git']).toBeDefined();
  });

  it('should include @semantic-release/npm in devDependencies', () => {
    expect(pkg.devDependencies['@semantic-release/npm']).toBeDefined();
  });

  it('should include @semantic-release/github in devDependencies', () => {
    expect(pkg.devDependencies['@semantic-release/github']).toBeDefined();
  });
});

describe('package.json existing fields unchanged', () => {
  it('should still have publishConfig.access set to public', () => {
    expect(pkg.publishConfig?.access).toBe('public');
  });

  it('should still have main set to dist/index.js', () => {
    expect(pkg.main).toBe('dist/index.js');
  });

  it('should still have bin.cadre set to dist/index.js', () => {
    expect(pkg.bin?.cadre).toBe('dist/index.js');
  });

  it('should still include dist/ in files field', () => {
    expect(pkg.files).toContain('dist/');
  });

  it('should still include src/agents/templates/ in files field', () => {
    expect(pkg.files).toContain('src/agents/templates/');
  });
});
