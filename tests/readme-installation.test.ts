import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const readme = readFileSync(resolve(__dirname, '../README.md'), 'utf8');

describe('README.md installation section', () => {
  it('should contain the global npm install command', () => {
    expect(readme).toContain('npm install -g cadre');
  });

  it('should reference npx cadre --version', () => {
    expect(readme).toContain('npx cadre --version');
  });

  it('should have an Installation section', () => {
    expect(readme).toMatch(/^#{1,3}\s+Installation/m);
  });

  it('should have Installation section appear before CLI Commands or usage section', () => {
    const installIdx = readme.search(/^#{1,3}\s+Installation/m);
    const usageIdx = readme.search(/^#{1,3}\s+(CLI Commands|Quick Start|Usage)/m);
    expect(installIdx).toBeGreaterThanOrEqual(0);
    expect(usageIdx).toBeGreaterThanOrEqual(0);
    expect(installIdx).toBeLessThan(usageIdx);
  });
});
