import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/util/fs.js', () => ({
  exists: vi.fn(),
  atomicWriteJSON: vi.fn(),
}));

vi.mock('../src/cli/prompts.js', () => ({
  collectAnswers: vi.fn(),
}));

vi.mock('@inquirer/prompts', () => ({
  confirm: vi.fn(),
}));

import { exists, atomicWriteJSON } from '../src/util/fs.js';
import { collectAnswers } from '../src/cli/prompts.js';
import { confirm } from '@inquirer/prompts';
import { runInit } from '../src/cli/init.js';

const mockExists = vi.mocked(exists);
const mockAtomicWriteJSON = vi.mocked(atomicWriteJSON);
const mockCollectAnswers = vi.mocked(collectAnswers);
const mockConfirm = vi.mocked(confirm);

const DEFAULT_ANSWERS = {
  projectName: 'my-project',
  platform: 'github' as const,
  repository: 'owner/repo',
  repoPath: '/tmp/repo',
  baseBranch: 'main',
  issueMode: { mode: 'query' as const, state: 'open' as const, limit: 10 },
  githubAuth: { method: 'token' as const, token: '${GITHUB_TOKEN}' },
  commands: {},
};

const REPO_PATH = '/tmp/test-repo';

function setupHappyPath() {
  mockExists.mockImplementation(async (p: string) => {
    if (p.endsWith('.git')) return true;
    if (p.endsWith('cadre.config.json')) return false;
    return false;
  });
  mockAtomicWriteJSON.mockResolvedValue(undefined);
  mockCollectAnswers.mockResolvedValue(DEFAULT_ANSWERS);
}

describe('runInit', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(process, 'exit').mockImplementation((_code?: number) => {
      throw new Error(`process.exit(${_code})`);
    });
  });

  describe('git repository check', () => {
    it('should exit with error when .git directory is not found', async () => {
      mockExists.mockResolvedValue(false);

      await expect(runInit({ yes: true, repoPath: REPO_PATH })).rejects.toThrow('process.exit(1)');
      expect(process.exit).toHaveBeenCalledWith(1);
      expect(console.error).toHaveBeenCalledWith(expect.stringContaining('.git'));
    });

    it('should check for .git in the provided repoPath', async () => {
      mockExists.mockResolvedValue(false);

      await expect(runInit({ yes: true, repoPath: REPO_PATH })).rejects.toThrow();
      expect(mockExists).toHaveBeenCalledWith(`${REPO_PATH}/.git`);
    });

    it('should check for .git in process.cwd() when repoPath is not provided', async () => {
      mockExists.mockResolvedValue(false);

      await expect(runInit({ yes: true })).rejects.toThrow();
      expect(mockExists).toHaveBeenCalledWith(`${process.cwd()}/.git`);
    });

    it('should proceed when .git directory exists', async () => {
      setupHappyPath();

      await runInit({ yes: true, repoPath: REPO_PATH });
      expect(process.exit).not.toHaveBeenCalled();
    });
  });

  describe('existing cadre.config.json', () => {
    it('should prompt for overwrite when config exists and --yes is false', async () => {
      mockExists.mockImplementation(async (p: string) => {
        if (p.endsWith('.git')) return true;
        if (p.endsWith('cadre.config.json')) return true;
        return false;
      });
      mockConfirm.mockResolvedValue(true);
      mockAtomicWriteJSON.mockResolvedValue(undefined);
      mockCollectAnswers.mockResolvedValue(DEFAULT_ANSWERS);

      await runInit({ yes: false, repoPath: REPO_PATH });

      expect(mockConfirm).toHaveBeenCalledWith(
        expect.objectContaining({ message: expect.stringContaining('cadre.config.json') }),
      );
    });

    it('should abort when user declines overwrite', async () => {
      mockExists.mockImplementation(async (p: string) => {
        if (p.endsWith('.git')) return true;
        if (p.endsWith('cadre.config.json')) return true;
        return false;
      });
      mockConfirm.mockResolvedValue(false);

      await runInit({ yes: false, repoPath: REPO_PATH });

      expect(mockAtomicWriteJSON).not.toHaveBeenCalled();
      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('Aborted'));
    });

    it('should skip overwrite prompt when --yes is true', async () => {
      mockExists.mockImplementation(async (p: string) => {
        if (p.endsWith('.git')) return true;
        if (p.endsWith('cadre.config.json')) return true;
        return false;
      });
      mockAtomicWriteJSON.mockResolvedValue(undefined);
      mockCollectAnswers.mockResolvedValue(DEFAULT_ANSWERS);

      await runInit({ yes: true, repoPath: REPO_PATH });

      expect(mockConfirm).not.toHaveBeenCalled();
      expect(mockAtomicWriteJSON).toHaveBeenCalled();
    });
  });

  describe('prompt collection', () => {
    it('should call collectAnswers with yes=true when --yes flag is set', async () => {
      setupHappyPath();

      await runInit({ yes: true, repoPath: REPO_PATH });

      expect(mockCollectAnswers).toHaveBeenCalledWith(true, REPO_PATH);
    });

    it('should call collectAnswers with yes=false when --yes flag is not set', async () => {
      setupHappyPath();
      mockConfirm.mockResolvedValue(true);

      await runInit({ yes: false, repoPath: REPO_PATH });

      expect(mockCollectAnswers).toHaveBeenCalledWith(false, REPO_PATH);
    });
  });

  describe('cadre.config.json writing', () => {
    it('should write cadre.config.json atomically', async () => {
      setupHappyPath();

      await runInit({ yes: true, repoPath: REPO_PATH });

      expect(mockAtomicWriteJSON).toHaveBeenCalledWith(
        `${REPO_PATH}/cadre.config.json`,
        expect.any(Object),
      );
    });

    it('should write config that passes CadreConfigSchema validation', async () => {
      setupHappyPath();

      await runInit({ yes: true, repoPath: REPO_PATH });

      const [, writtenConfig] = mockAtomicWriteJSON.mock.calls[0];
      const { CadreConfigSchema } = await import('../src/config/schema.js');
      expect(() => CadreConfigSchema.parse(writtenConfig)).not.toThrow();
    });

    it('should assemble config with query-based issue mode', async () => {
      setupHappyPath();
      mockCollectAnswers.mockResolvedValue({
        ...DEFAULT_ANSWERS,
        issueMode: { mode: 'query', state: 'open', limit: 10 },
      });

      await runInit({ yes: true, repoPath: REPO_PATH });

      const [, writtenConfig] = mockAtomicWriteJSON.mock.calls[0];
      expect(writtenConfig).toMatchObject({
        issues: { query: { state: 'open', limit: 10 } },
      });
    });

    it('should assemble config with ids-based issue mode', async () => {
      setupHappyPath();
      mockCollectAnswers.mockResolvedValue({
        ...DEFAULT_ANSWERS,
        issueMode: { mode: 'ids' },
      });

      await runInit({ yes: true, repoPath: REPO_PATH });

      const [, writtenConfig] = mockAtomicWriteJSON.mock.calls[0];
      expect(writtenConfig).toMatchObject({ issues: { ids: [] } });
    });

    it('should include github token auth in config', async () => {
      setupHappyPath();
      mockCollectAnswers.mockResolvedValue({
        ...DEFAULT_ANSWERS,
        githubAuth: { method: 'token', token: '${GITHUB_TOKEN}' },
      });

      await runInit({ yes: true, repoPath: REPO_PATH });

      const [, writtenConfig] = mockAtomicWriteJSON.mock.calls[0];
      expect(writtenConfig).toMatchObject({
        github: { auth: { token: '${GITHUB_TOKEN}' } },
      });
    });

    it('should include github app auth in config', async () => {
      setupHappyPath();
      mockCollectAnswers.mockResolvedValue({
        ...DEFAULT_ANSWERS,
        githubAuth: {
          method: 'app',
          appId: '123',
          installationId: '456',
          privateKeyFile: '/key.pem',
        },
      });

      await runInit({ yes: true, repoPath: REPO_PATH });

      const [, writtenConfig] = mockAtomicWriteJSON.mock.calls[0];
      expect(writtenConfig).toMatchObject({
        github: {
          auth: { appId: '123', installationId: '456', privateKeyFile: '/key.pem' },
        },
      });
    });

    it('should default github auth to GITHUB_TOKEN when platform is github and no auth provided', async () => {
      setupHappyPath();
      mockCollectAnswers.mockResolvedValue({
        ...DEFAULT_ANSWERS,
        githubAuth: undefined,
      });

      await runInit({ yes: true, repoPath: REPO_PATH });

      const [, writtenConfig] = mockAtomicWriteJSON.mock.calls[0];
      expect(writtenConfig).toMatchObject({
        github: { auth: { token: '${GITHUB_TOKEN}' } },
      });
    });

    it('should not include github section when platform is azure-devops', async () => {
      setupHappyPath();
      mockCollectAnswers.mockResolvedValue({
        ...DEFAULT_ANSWERS,
        platform: 'azure-devops',
        repository: 'my-repo',
        githubAuth: undefined,
      });

      await runInit({ yes: true, repoPath: REPO_PATH });

      const [, writtenConfig] = mockAtomicWriteJSON.mock.calls[0];
      expect(writtenConfig).not.toHaveProperty('github');
    });
  });

  describe('success output', () => {
    it('should print success message after initialization', async () => {
      setupHappyPath();

      await runInit({ yes: true, repoPath: REPO_PATH });

      expect(console.log).toHaveBeenCalledWith(expect.stringContaining('cadre initialized successfully'));
    });

    it('should print project details in success summary', async () => {
      setupHappyPath();

      await runInit({ yes: true, repoPath: REPO_PATH });

      const logCalls = vi.mocked(console.log).mock.calls.flat().join(' ');
      expect(logCalls).toContain('my-project');
      expect(logCalls).toContain('owner/repo');
    });
  });
});
