import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { mkdtemp, rm, readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Mock prompts to avoid interactive input
vi.mock('../src/cli/prompts.js', () => ({
  runPrompts: vi.fn(),
}));

import { runPrompts } from '../src/cli/prompts.js';
import { runInit } from '../src/cli/init.js';
import { CadreConfigSchema } from '../src/config/schema.js';

const mockRunPrompts = vi.mocked(runPrompts);

const VALID_ANSWERS = {
  projectName: 'my-project',
  platform: 'github' as const,
  repository: 'owner/repo',
  repoPath: '/tmp/repo',
  baseBranch: 'main',
  issueMode: 'query' as const,
  githubAuthMethod: 'auto-detect' as const,
  commands: {},
};

describe('cli-init integration', () => {
  let tmpDir: string;

  afterEach(async () => {
    if (tmpDir) {
      await rm(tmpDir, { recursive: true, force: true });
      tmpDir = '';
    }
    vi.restoreAllMocks();
  });

  async function createTempRepo(): Promise<string> {
    tmpDir = await mkdtemp(join(tmpdir(), 'cadre-init-test-'));
    await mkdir(join(tmpDir, '.git'));
    return tmpDir;
  }

  describe('git repo validation', () => {
    it('throws when .git is absent', async () => {
      tmpDir = await mkdtemp(join(tmpdir(), 'cadre-init-test-'));
      // No .git directory — simulates missing git repo (same code path as no --repo-path in a non-git cwd)
      await expect(runInit({ yes: true, repoPath: tmpDir })).rejects.toThrow(
        /Not a git repository/,
      );
    });
  });

  describe('successful initialization', () => {
    beforeEach(() => {
      vi.spyOn(console, 'log').mockImplementation(() => {});
    });

    it('writes cadre.config.json parseable by CadreConfigSchema.parse()', async () => {
      const dir = await createTempRepo();
      mockRunPrompts.mockResolvedValue({ ...VALID_ANSWERS, repoPath: dir });

      await runInit({ yes: true, repoPath: dir });

      const raw = await readFile(join(dir, 'cadre.config.json'), 'utf-8');
      const parsed = JSON.parse(raw);
      expect(() => CadreConfigSchema.parse(parsed)).not.toThrow();
    });

    it('creates .github/agents/ directory', async () => {
      const dir = await createTempRepo();
      mockRunPrompts.mockResolvedValue({ ...VALID_ANSWERS, repoPath: dir });

      await runInit({ yes: true, repoPath: dir });

      const info = await stat(join(dir, '.github', 'agents'));
      expect(info.isDirectory()).toBe(true);
    });

    it('adds .cadre/ to .gitignore when no .gitignore exists', async () => {
      const dir = await createTempRepo();
      mockRunPrompts.mockResolvedValue({ ...VALID_ANSWERS, repoPath: dir });

      await runInit({ yes: true, repoPath: dir });

      const content = await readFile(join(dir, '.gitignore'), 'utf-8');
      expect(content).toContain('.cadre/');
    });

    it('preserves existing .gitignore content when appending .cadre/', async () => {
      const dir = await createTempRepo();
      await writeFile(join(dir, '.gitignore'), 'node_modules/\ndist/\n');
      mockRunPrompts.mockResolvedValue({ ...VALID_ANSWERS, repoPath: dir });

      await runInit({ yes: true, repoPath: dir });

      const content = await readFile(join(dir, '.gitignore'), 'utf-8');
      expect(content).toContain('node_modules/');
      expect(content).toContain('dist/');
      expect(content).toContain('.cadre/');
    });

    it('does not duplicate .cadre/ when already present in .gitignore', async () => {
      const dir = await createTempRepo();
      await writeFile(join(dir, '.gitignore'), 'node_modules/\n.cadre/\n');
      mockRunPrompts.mockResolvedValue({ ...VALID_ANSWERS, repoPath: dir });

      await runInit({ yes: true, repoPath: dir });

      const content = await readFile(join(dir, '.gitignore'), 'utf-8');
      const matches = content.split('\n').filter((l) => l.trim() === '.cadre/');
      expect(matches).toHaveLength(1);
    });
  });
});
