import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(resolve(__dirname, '../package.json'), 'utf8'));

describe('package.json files field', () => {
  it('should have a files field', () => {
    expect(pkg.files).toBeDefined();
    expect(Array.isArray(pkg.files)).toBe(true);
  });

  it('should include dist/ in files field', () => {
    expect(pkg.files).toContain('dist/');
  });

  it('should include src/agents/templates/ in files field', () => {
    expect(pkg.files).toContain('src/agents/templates/');
  });

  it('should have exactly the expected entries in files field', () => {
    expect(pkg.files).toEqual(['dist/', 'src/agents/templates/']);
  });
});
