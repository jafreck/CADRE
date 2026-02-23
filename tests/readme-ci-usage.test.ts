import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const readme = readFileSync(resolve(__dirname, '../README.md'), 'utf8');

describe('README CI Usage section', () => {
  it('should contain a CI Usage section heading', () => {
    expect(readme).toMatch(/##\s+CI Usage/);
  });

  it('should reference the example workflow file by path', () => {
    expect(readme).toContain('.github/workflows/cadre-example.yml');
  });

  it('should document PAT token authentication option', () => {
    expect(readme).toMatch(/PAT\s+(T|t)oken|Personal Access Token/);
  });

  it('should document GitHub App authentication option', () => {
    expect(readme).toMatch(/GitHub App/);
    expect(readme).toContain('appId');
    expect(readme).toContain('installationId');
    expect(readme).toContain('privateKeyFile');
  });

  it('should explain repoPath pointing to the GitHub Actions workspace', () => {
    expect(readme).toMatch(/repoPath/);
    expect(readme).toMatch(/GITHUB_WORKSPACE|\$\{\{.*github\.workspace.*\}\}/);
  });

  it('should list required GitHub App permissions', () => {
    expect(readme).toMatch(/Issues.*Read|Read.*Issues/is);
    expect(readme).toMatch(/Pull Requests.*Write|Write.*Pull Requests/is);
    expect(readme).toMatch(/Contents.*Write|Write.*Contents/is);
  });
});
