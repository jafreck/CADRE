import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(resolve(__dirname, '../package.json'), 'utf8'));

describe('package.json publishConfig', () => {
  it('should have a publishConfig field', () => {
    expect(pkg.publishConfig).toBeDefined();
  });

  it('should set access to public', () => {
    expect(pkg.publishConfig.access).toBe('public');
  });
});

describe('package.json main field', () => {
  it('should have a main field', () => {
    expect(pkg.main).toBeDefined();
  });

  it('should point to dist/index.js', () => {
    expect(pkg.main).toBe('dist/index.js');
  });
});

describe('package.json files field exclusions', () => {
  it('should not include src/ directly in files field', () => {
    expect(pkg.files).not.toContain('src/');
  });

  it('should not include tests/ in files field', () => {
    expect(pkg.files).not.toContain('tests/');
  });

  it('should not include .cadre/ in files field', () => {
    expect(pkg.files).not.toContain('.cadre/');
  });
});
