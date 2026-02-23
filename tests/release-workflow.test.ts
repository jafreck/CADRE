import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const WORKFLOW_PATH = resolve(__dirname, '../.github/workflows/release.yml');

describe('.github/workflows/release.yml', () => {
  it('should exist at .github/workflows/release.yml', () => {
    expect(existsSync(WORKFLOW_PATH)).toBe(true);
  });

  it('should be non-empty', () => {
    const content = readFileSync(WORKFLOW_PATH, 'utf-8');
    expect(content.trim().length).toBeGreaterThan(0);
  });

  describe('trigger', () => {
    it('should trigger on push to main', () => {
      const content = readFileSync(WORKFLOW_PATH, 'utf-8');
      expect(content).toMatch(/on:/);
      expect(content).toMatch(/push:/);
      expect(content).toMatch(/branches:/);
      expect(content).toMatch(/- main/);
    });
  });

  describe('permissions', () => {
    it('should have contents: write permission', () => {
      const content = readFileSync(WORKFLOW_PATH, 'utf-8');
      expect(content).toMatch(/contents:\s*write/);
    });

    it('should have issues: write permission', () => {
      const content = readFileSync(WORKFLOW_PATH, 'utf-8');
      expect(content).toMatch(/issues:\s*write/);
    });

    it('should have pull-requests: write permission', () => {
      const content = readFileSync(WORKFLOW_PATH, 'utf-8');
      expect(content).toMatch(/pull-requests:\s*write/);
    });

    it('should have id-token: write permission', () => {
      const content = readFileSync(WORKFLOW_PATH, 'utf-8');
      expect(content).toMatch(/id-token:\s*write/);
    });
  });

  describe('checkout step', () => {
    it('should use actions/checkout@v4', () => {
      const content = readFileSync(WORKFLOW_PATH, 'utf-8');
      expect(content).toMatch(/uses:\s*actions\/checkout@v4/);
    });

    it('should use fetch-depth: 0', () => {
      const content = readFileSync(WORKFLOW_PATH, 'utf-8');
      expect(content).toMatch(/fetch-depth:\s*0/);
    });
  });

  describe('setup-node step', () => {
    it('should use actions/setup-node@v4', () => {
      const content = readFileSync(WORKFLOW_PATH, 'utf-8');
      expect(content).toMatch(/uses:\s*actions\/setup-node@v4/);
    });

    it('should set node-version to 22', () => {
      const content = readFileSync(WORKFLOW_PATH, 'utf-8');
      expect(content).toMatch(/node-version:\s*['"]?22['"]?/);
    });
  });

  describe('build steps', () => {
    it('should run npm ci', () => {
      const content = readFileSync(WORKFLOW_PATH, 'utf-8');
      expect(content).toMatch(/run:\s*npm ci/);
    });

    it('should run npm run build', () => {
      const content = readFileSync(WORKFLOW_PATH, 'utf-8');
      expect(content).toMatch(/run:\s*npm run build/);
    });
  });

  describe('release step', () => {
    it('should run npx semantic-release', () => {
      const content = readFileSync(WORKFLOW_PATH, 'utf-8');
      expect(content).toMatch(/run:\s*npx semantic-release/);
    });

    it('should pass GITHUB_TOKEN from secrets', () => {
      const content = readFileSync(WORKFLOW_PATH, 'utf-8');
      expect(content).toMatch(/GITHUB_TOKEN:.*secrets\.GITHUB_TOKEN/);
    });

    it('should pass NPM_TOKEN from secrets', () => {
      const content = readFileSync(WORKFLOW_PATH, 'utf-8');
      expect(content).toMatch(/NPM_TOKEN:.*secrets\.NPM_TOKEN/);
    });
  });
});
