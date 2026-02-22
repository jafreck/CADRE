import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { PromptAnswers } from '../src/cli/prompts.js';

// Mock @inquirer/prompts
vi.mock('@inquirer/prompts', () => ({
  input: vi.fn(),
  select: vi.fn(),
  confirm: vi.fn(),
}));

// Mock simple-git
vi.mock('simple-git', () => {
  const mockGit = {
    getRemotes: vi.fn(),
  };
  return {
    simpleGit: vi.fn(() => mockGit),
    default: vi.fn(() => mockGit),
  };
});

// Mock node:fs/promises
vi.mock('node:fs/promises', () => ({
  access: vi.fn(),
}));

import { input, select, confirm } from '@inquirer/prompts';
import { simpleGit } from 'simple-git';
import { access } from 'node:fs/promises';

const mockInput = vi.mocked(input);
const mockSelect = vi.mocked(select);
const mockConfirm = vi.mocked(confirm);
const mockSimpleGit = vi.mocked(simpleGit);
const mockAccess = vi.mocked(access);

describe('runPrompts', () => {
  let runPrompts: (opts: { yes: boolean }) => Promise<PromptAnswers>;

  beforeEach(async () => {
    vi.resetAllMocks();
    const mod = await import('../src/cli/prompts.js');
    runPrompts = mod.runPrompts;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('--yes mode (non-interactive)', () => {
    it('should return defaults without throwing', async () => {
      const mockGit = { getRemotes: vi.fn().mockResolvedValue([]) };
      mockSimpleGit.mockReturnValue(mockGit as any);

      const result = await runPrompts({ yes: true });

      expect(result).toBeDefined();
      expect(result.platform).toBe('github');
      expect(result.baseBranch).toBe('main');
      expect(result.issueMode).toBe('query');
      expect(result.githubAuthMethod).toBe('auto-detect');
      expect(result.commands).toEqual({});
    });

    it('should derive repository and projectName from git remote (HTTPS)', async () => {
      const mockGit = {
        getRemotes: vi.fn().mockResolvedValue([
          { name: 'origin', refs: { fetch: 'https://github.com/owner/my-repo.git' } },
        ]),
      };
      mockSimpleGit.mockReturnValue(mockGit as any);

      const result = await runPrompts({ yes: true });

      expect(result.repository).toBe('owner/my-repo');
      expect(result.projectName).toBe('my-repo');
    });

    it('should derive repository and projectName from git remote (SSH)', async () => {
      const mockGit = {
        getRemotes: vi.fn().mockResolvedValue([
          { name: 'origin', refs: { fetch: 'git@github.com:owner/my-repo.git' } },
        ]),
      };
      mockSimpleGit.mockReturnValue(mockGit as any);

      const result = await runPrompts({ yes: true });

      expect(result.repository).toBe('owner/my-repo');
      expect(result.projectName).toBe('my-repo');
    });

    it('should use first remote when no origin found', async () => {
      const mockGit = {
        getRemotes: vi.fn().mockResolvedValue([
          { name: 'upstream', refs: { fetch: 'https://github.com/org/project.git' } },
        ]),
      };
      mockSimpleGit.mockReturnValue(mockGit as any);

      const result = await runPrompts({ yes: true });

      expect(result.repository).toBe('org/project');
      expect(result.projectName).toBe('project');
    });

    it('should return empty strings and warn when no git remote available', async () => {
      const mockGit = { getRemotes: vi.fn().mockResolvedValue([]) };
      mockSimpleGit.mockReturnValue(mockGit as any);
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const result = await runPrompts({ yes: true });

      expect(result.repository).toBe('');
      expect(result.projectName).toBe('');
      expect(warnSpy).toHaveBeenCalledTimes(2);
    });

    it('should return empty strings and warn when simple-git throws', async () => {
      mockSimpleGit.mockReturnValue({ getRemotes: vi.fn().mockRejectedValue(new Error('not a git repo')) } as any);
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const result = await runPrompts({ yes: true });

      expect(result.repository).toBe('');
      expect(result.projectName).toBe('');
      expect(warnSpy).toHaveBeenCalledTimes(2);
    });

    it('should set repoPath to process.cwd()', async () => {
      const mockGit = { getRemotes: vi.fn().mockResolvedValue([]) };
      mockSimpleGit.mockReturnValue(mockGit as any);
      vi.spyOn(console, 'warn').mockImplementation(() => {});

      const result = await runPrompts({ yes: true });

      expect(result.repoPath).toBe(process.cwd());
    });

    it('should not call any @inquirer/prompts functions', async () => {
      const mockGit = { getRemotes: vi.fn().mockResolvedValue([]) };
      mockSimpleGit.mockReturnValue(mockGit as any);
      vi.spyOn(console, 'warn').mockImplementation(() => {});

      await runPrompts({ yes: true });

      expect(mockInput).not.toHaveBeenCalled();
      expect(mockSelect).not.toHaveBeenCalled();
      expect(mockConfirm).not.toHaveBeenCalled();
    });

    it('should sanitize project name (replace non-alphanumeric with hyphens)', async () => {
      const mockGit = {
        getRemotes: vi.fn().mockResolvedValue([
          { name: 'origin', refs: { fetch: 'https://github.com/owner/My_Repo-Name.git' } },
        ]),
      };
      mockSimpleGit.mockReturnValue(mockGit as any);

      const result = await runPrompts({ yes: true });

      expect(result.projectName).toMatch(/^[a-z0-9-]+$/);
    });
  });

  describe('interactive mode (yes: false)', () => {
    function setupInteractiveDefaults() {
      mockInput.mockImplementation(async (opts: any) => {
        if (opts.message === 'Project name:') return 'my-project';
        if (opts.message === 'Repository (owner/repo):') return 'owner/repo';
        if (opts.message === 'Local repo path:') return '/tmp/repo';
        if (opts.message === 'Base branch:') return 'main';
        return '';
      });
      mockSelect.mockImplementation(async (opts: any) => {
        if (opts.message === 'Platform:') return 'github';
        if (opts.message === 'Issue selection mode:') return 'query';
        if (opts.message === 'GitHub auth method:') return 'auto-detect';
        return '';
      });
      mockConfirm.mockResolvedValue(false);
      mockAccess.mockResolvedValue(undefined);
    }

    it('should return typed PromptAnswers with all required fields', async () => {
      setupInteractiveDefaults();

      const result = await runPrompts({ yes: false });

      expect(result.projectName).toBe('my-project');
      expect(result.platform).toBe('github');
      expect(result.repository).toBe('owner/repo');
      expect(result.repoPath).toBe('/tmp/repo');
      expect(result.baseBranch).toBe('main');
      expect(result.issueMode).toBe('query');
      expect(result.githubAuthMethod).toBe('auto-detect');
      expect(result.commands).toBeDefined();
    });

    it('should omit commands when all command confirms are false', async () => {
      setupInteractiveDefaults();

      const result = await runPrompts({ yes: false });

      expect(result.commands.install).toBeUndefined();
      expect(result.commands.build).toBeUndefined();
      expect(result.commands.test).toBeUndefined();
      expect(result.commands.lint).toBeUndefined();
    });

    it('should collect commands when confirms are true', async () => {
      mockInput.mockImplementation(async (opts: any) => {
        if (opts.message === 'Project name:') return 'my-project';
        if (opts.message === 'Repository (owner/repo):') return 'owner/repo';
        if (opts.message === 'Local repo path:') return '/tmp/repo';
        if (opts.message === 'Base branch:') return 'main';
        if (opts.message === 'Install command:') return 'npm install';
        if (opts.message === 'Build command:') return 'npm run build';
        if (opts.message === 'Test command:') return 'npm test';
        if (opts.message === 'Lint command:') return 'npm run lint';
        return '';
      });
      mockSelect.mockImplementation(async (opts: any) => {
        if (opts.message === 'Platform:') return 'github';
        if (opts.message === 'Issue selection mode:') return 'ids';
        if (opts.message === 'GitHub auth method:') return 'token';
        return '';
      });
      mockConfirm.mockResolvedValue(true);
      mockAccess.mockResolvedValue(undefined);

      const result = await runPrompts({ yes: false });

      expect(result.commands.install).toBe('npm install');
      expect(result.commands.build).toBe('npm run build');
      expect(result.commands.test).toBe('npm test');
      expect(result.commands.lint).toBe('npm run lint');
      expect(result.githubAuthMethod).toBe('token');
    });

    it('should skip github auth prompt for azure-devops platform', async () => {
      mockInput.mockImplementation(async (opts: any) => {
        if (opts.message === 'Project name:') return 'my-project';
        if (opts.message === 'Repository:') return 'my-azure-repo';
        if (opts.message === 'Local repo path:') return '/tmp/repo';
        if (opts.message === 'Base branch:') return 'main';
        return '';
      });
      mockSelect.mockImplementation(async (opts: any) => {
        if (opts.message === 'Platform:') return 'azure-devops';
        if (opts.message === 'Issue selection mode:') return 'query';
        return '';
      });
      mockConfirm.mockResolvedValue(false);
      mockAccess.mockResolvedValue(undefined);

      const result = await runPrompts({ yes: false });

      expect(result.platform).toBe('azure-devops');
      expect(result.githubAuthMethod).toBe('auto-detect');
      // github auth select should NOT be called
      const selectCalls = mockSelect.mock.calls.map((c: any[]) => c[0].message);
      expect(selectCalls).not.toContain('GitHub auth method:');
    });

    it('should validate project name inline (rejects invalid names)', async () => {
      let capturedValidate: ((v: string) => boolean | string) | undefined;
      mockInput.mockImplementation(async (opts: any) => {
        if (opts.message === 'Project name:') {
          capturedValidate = opts.validate;
          return 'valid-name';
        }
        if (opts.message === 'Repository (owner/repo):') return 'owner/repo';
        if (opts.message === 'Local repo path:') return '/tmp/repo';
        if (opts.message === 'Base branch:') return 'main';
        return '';
      });
      mockSelect.mockImplementation(async (opts: any) => {
        if (opts.message === 'Platform:') return 'github';
        if (opts.message === 'Issue selection mode:') return 'query';
        if (opts.message === 'GitHub auth method:') return 'auto-detect';
        return '';
      });
      mockConfirm.mockResolvedValue(false);
      mockAccess.mockResolvedValue(undefined);

      await runPrompts({ yes: false });

      expect(capturedValidate).toBeDefined();
      expect(capturedValidate!('valid-name')).toBe(true);
      expect(capturedValidate!('Invalid Name!')).not.toBe(true);
      expect(capturedValidate!('123-abc')).toBe(true);
      expect(capturedValidate!('')).not.toBe(true);
      expect(capturedValidate!('UPPER')).not.toBe(true);
    });

    it('should validate repository as owner/repo for github platform', async () => {
      let capturedRepoValidate: ((v: string) => boolean | string) | undefined;
      mockInput.mockImplementation(async (opts: any) => {
        if (opts.message === 'Project name:') return 'my-project';
        if (opts.message === 'Repository (owner/repo):') {
          capturedRepoValidate = opts.validate;
          return 'owner/repo';
        }
        if (opts.message === 'Local repo path:') return '/tmp/repo';
        if (opts.message === 'Base branch:') return 'main';
        return '';
      });
      mockSelect.mockImplementation(async (opts: any) => {
        if (opts.message === 'Platform:') return 'github';
        if (opts.message === 'Issue selection mode:') return 'query';
        if (opts.message === 'GitHub auth method:') return 'auto-detect';
        return '';
      });
      mockConfirm.mockResolvedValue(false);
      mockAccess.mockResolvedValue(undefined);

      await runPrompts({ yes: false });

      expect(capturedRepoValidate).toBeDefined();
      expect(capturedRepoValidate!('owner/repo')).toBe(true);
      expect(capturedRepoValidate!('owner/repo/extra')).not.toBe(true); // too many segments
      expect(capturedRepoValidate!('noslash')).not.toBe(true);
      expect(capturedRepoValidate!('')).not.toBe(true);
    });

    it('should validate repo path checks for .git directory', async () => {
      let capturedRepoPathValidate: ((v: string) => Promise<boolean | string>) | undefined;
      mockInput.mockImplementation(async (opts: any) => {
        if (opts.message === 'Project name:') return 'my-project';
        if (opts.message === 'Repository (owner/repo):') return 'owner/repo';
        if (opts.message === 'Local repo path:') {
          capturedRepoPathValidate = opts.validate;
          return '/tmp/repo';
        }
        if (opts.message === 'Base branch:') return 'main';
        return '';
      });
      mockSelect.mockImplementation(async (opts: any) => {
        if (opts.message === 'Platform:') return 'github';
        if (opts.message === 'Issue selection mode:') return 'query';
        if (opts.message === 'GitHub auth method:') return 'auto-detect';
        return '';
      });
      mockConfirm.mockResolvedValue(false);
      mockAccess.mockResolvedValue(undefined);

      await runPrompts({ yes: false });

      expect(capturedRepoPathValidate).toBeDefined();

      // Valid path: access succeeds
      mockAccess.mockResolvedValue(undefined);
      expect(await capturedRepoPathValidate!('/tmp/repo')).toBe(true);

      // Invalid path: access throws
      mockAccess.mockRejectedValue(new Error('ENOENT'));
      const invalid = await capturedRepoPathValidate!('/nonexistent');
      expect(invalid).not.toBe(true);
      expect(typeof invalid).toBe('string');
    });
  });

  describe('PromptAnswers interface', () => {
    it('should export PromptAnswers as a type', async () => {
      // Type-level check: if PromptAnswers is not exported, this import would fail at build time.
      // This test verifies the module exports are accessible.
      const mod = await import('../src/cli/prompts.js');
      expect(typeof mod.runPrompts).toBe('function');
    });
  });
});
