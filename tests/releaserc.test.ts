import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const RELEASERC_PATH = resolve(__dirname, '../.releaserc.json');

describe('.releaserc.json', () => {
  it('should exist at the repo root', () => {
    expect(existsSync(RELEASERC_PATH)).toBe(true);
  });

  it('should be valid JSON', () => {
    const content = readFileSync(RELEASERC_PATH, 'utf-8');
    expect(() => JSON.parse(content)).not.toThrow();
  });

  describe('branches', () => {
    it('should have branches set to ["main"]', () => {
      const config = JSON.parse(readFileSync(RELEASERC_PATH, 'utf-8'));
      expect(config.branches).toEqual(['main']);
    });
  });

  describe('plugins', () => {
    it('should have a plugins array', () => {
      const config = JSON.parse(readFileSync(RELEASERC_PATH, 'utf-8'));
      expect(Array.isArray(config.plugins)).toBe(true);
    });

    it('should include @semantic-release/commit-analyzer', () => {
      const config = JSON.parse(readFileSync(RELEASERC_PATH, 'utf-8'));
      const pluginNames = config.plugins.map((p: unknown) => (Array.isArray(p) ? p[0] : p));
      expect(pluginNames).toContain('@semantic-release/commit-analyzer');
    });

    it('should include @semantic-release/release-notes-generator', () => {
      const config = JSON.parse(readFileSync(RELEASERC_PATH, 'utf-8'));
      const pluginNames = config.plugins.map((p: unknown) => (Array.isArray(p) ? p[0] : p));
      expect(pluginNames).toContain('@semantic-release/release-notes-generator');
    });

    it('should include @semantic-release/changelog', () => {
      const config = JSON.parse(readFileSync(RELEASERC_PATH, 'utf-8'));
      const pluginNames = config.plugins.map((p: unknown) => (Array.isArray(p) ? p[0] : p));
      expect(pluginNames).toContain('@semantic-release/changelog');
    });

    it('should include @semantic-release/npm', () => {
      const config = JSON.parse(readFileSync(RELEASERC_PATH, 'utf-8'));
      const pluginNames = config.plugins.map((p: unknown) => (Array.isArray(p) ? p[0] : p));
      expect(pluginNames).toContain('@semantic-release/npm');
    });

    it('should include @semantic-release/git with CHANGELOG.md and package.json as assets', () => {
      const config = JSON.parse(readFileSync(RELEASERC_PATH, 'utf-8'));
      const gitEntry = config.plugins.find(
        (p: unknown) => Array.isArray(p) && p[0] === '@semantic-release/git',
      ) as [string, { assets: string[] }] | undefined;
      expect(gitEntry).toBeDefined();
      expect(gitEntry![1].assets).toContain('CHANGELOG.md');
      expect(gitEntry![1].assets).toContain('package.json');
    });

    it('should include @semantic-release/github', () => {
      const config = JSON.parse(readFileSync(RELEASERC_PATH, 'utf-8'));
      const pluginNames = config.plugins.map((p: unknown) => (Array.isArray(p) ? p[0] : p));
      expect(pluginNames).toContain('@semantic-release/github');
    });

    it('should list plugins in the correct order', () => {
      const config = JSON.parse(readFileSync(RELEASERC_PATH, 'utf-8'));
      const pluginNames = config.plugins.map((p: unknown) => (Array.isArray(p) ? p[0] : p));
      const expected = [
        '@semantic-release/commit-analyzer',
        '@semantic-release/release-notes-generator',
        '@semantic-release/changelog',
        '@semantic-release/npm',
        '@semantic-release/git',
        '@semantic-release/github',
      ];
      expect(pluginNames).toEqual(expected);
    });
  });
});
