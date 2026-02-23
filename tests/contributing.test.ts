import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const contributingPath = resolve(__dirname, '../CONTRIBUTING.md');

describe('CONTRIBUTING.md', () => {
  it('should exist at the repo root', () => {
    expect(existsSync(contributingPath)).toBe(true);
  });

  describe('content', () => {
    let content: string;

    beforeEach(() => {
      content = readFileSync(contributingPath, 'utf8');
    });

    it('should document the NPM_TOKEN secret name', () => {
      expect(content).toContain('NPM_TOKEN');
    });

    it('should document where to add the secret in GitHub', () => {
      // Accepts any reasonable description of GitHub Actions secrets location
      expect(content.toLowerCase()).toMatch(/settings.*secrets|secrets.*settings/s);
    });

    it('should explain how to create an NPM Automation token', () => {
      expect(content.toLowerCase()).toContain('automation');
      expect(content.toLowerCase()).toContain('access token');
    });

    it('should document the fix: commit prefix for Conventional Commits', () => {
      expect(content).toContain('fix:');
    });

    it('should document the feat: commit prefix for Conventional Commits', () => {
      expect(content).toContain('feat:');
    });

    it('should document breaking change syntax', () => {
      expect(content).toMatch(/feat!:|BREAKING CHANGE/);
    });

    it('should mention Conventional Commits', () => {
      expect(content.toLowerCase()).toContain('conventional commit');
    });
  });
});
