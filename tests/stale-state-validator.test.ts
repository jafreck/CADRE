import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { SimpleGit } from 'simple-git';
import { checkStaleState } from '../src/validation/stale-state-validator.js';
import { makeRuntimeConfig } from './helpers/make-runtime-config.js';
import type { PlatformProvider, PullRequestInfo } from '../src/platform/provider.js';

// Mock the fs utility so tests don't touch the real filesystem
vi.mock('../src/util/fs.js', () => ({
  exists: vi.fn().mockResolvedValue(false),
}));

import * as fsUtils from '../src/util/fs.js';

// Minimal SimpleGit mock
function makeGit(lsRemoteOutput = ''): SimpleGit {
  return {
    raw: vi.fn().mockResolvedValue(lsRemoteOutput),
  } as unknown as SimpleGit;
}

// Minimal PlatformProvider mock
function makeProvider(prs: PullRequestInfo[] = []): PlatformProvider {
  return {
    listPullRequests: vi.fn().mockResolvedValue(prs),
  } as unknown as PlatformProvider;
}

const ISSUE_NUMBER = 42;
const BASE_CONFIG = makeRuntimeConfig({
  branchTemplate: 'cadre/issue-{issue}',
  worktreeRoot: '/tmp/worktrees',
  stateDir: '/tmp/.cadre/test-project',
});
const EXPECTED_BRANCH = 'cadre/issue-42';

describe('checkStaleState', () => {
  beforeEach(() => {
    vi.mocked(fsUtils.exists).mockResolvedValue(false);
  });

  describe('all-clear path', () => {
    it('returns hasConflicts=false when no stale state exists', async () => {
      const result = await checkStaleState([ISSUE_NUMBER], BASE_CONFIG, makeProvider(), makeGit());
      expect(result.hasConflicts).toBe(false);
      expect(result.conflicts.size).toBe(0);
    });
  });

  describe('worktree detection', () => {
    it('detects existing local worktree directory', async () => {
      vi.mocked(fsUtils.exists).mockImplementation(async (p) =>
        String(p).includes('issue-42') && !String(p).includes('issues'),
      );

      const result = await checkStaleState([ISSUE_NUMBER], BASE_CONFIG, makeProvider(), makeGit());

      expect(result.hasConflicts).toBe(true);
      const conflicts = result.conflicts.get(ISSUE_NUMBER);
      expect(conflicts).toBeDefined();
      expect(conflicts?.some((c) => c.kind === 'worktree')).toBe(true);
    });
  });

  describe('remote branch detection', () => {
    it('detects existing remote branch via git ls-remote', async () => {
      const lsRemoteOutput = `abc123\trefs/heads/${EXPECTED_BRANCH}\n`;
      const git = makeGit(lsRemoteOutput);

      const result = await checkStaleState([ISSUE_NUMBER], BASE_CONFIG, makeProvider(), git);

      expect(result.hasConflicts).toBe(true);
      const conflicts = result.conflicts.get(ISSUE_NUMBER);
      expect(conflicts?.some((c) => c.kind === 'remote-branch')).toBe(true);
    });

    it('does not flag remote branch when ls-remote returns empty', async () => {
      const result = await checkStaleState([ISSUE_NUMBER], BASE_CONFIG, makeProvider(), makeGit(''));

      expect(result.hasConflicts).toBe(false);
    });

    it('does not block the run if git ls-remote throws', async () => {
      const git = { raw: vi.fn().mockRejectedValue(new Error('network error')) } as unknown as SimpleGit;

      const result = await checkStaleState([ISSUE_NUMBER], BASE_CONFIG, makeProvider(), git);

      expect(result.hasConflicts).toBe(false);
    });
  });

  describe('open PR detection', () => {
    it('detects an existing open PR matching the branch', async () => {
      const pr: PullRequestInfo = {
        number: 7,
        url: 'https://github.com/owner/repo/pull/7',
        title: 'WIP: issue 42',
        headBranch: EXPECTED_BRANCH,
        baseBranch: 'main',
        state: 'open',
      };
      const provider = makeProvider([pr]);

      const result = await checkStaleState([ISSUE_NUMBER], BASE_CONFIG, provider, makeGit());

      expect(result.hasConflicts).toBe(true);
      const conflicts = result.conflicts.get(ISSUE_NUMBER);
      expect(conflicts?.some((c) => c.kind === 'open-pr')).toBe(true);
      expect(conflicts?.find((c) => c.kind === 'open-pr')?.description).toContain('PR #7');
    });

    it('does not flag open PR when provider returns empty list', async () => {
      const result = await checkStaleState([ISSUE_NUMBER], BASE_CONFIG, makeProvider([]), makeGit());

      expect(result.hasConflicts).toBe(false);
    });

    it('does not block the run if provider.listPullRequests throws', async () => {
      const provider = {
        listPullRequests: vi.fn().mockRejectedValue(new Error('auth error')),
      } as unknown as PlatformProvider;

      const result = await checkStaleState([ISSUE_NUMBER], BASE_CONFIG, provider, makeGit());

      expect(result.hasConflicts).toBe(false);
    });
  });

  describe('checkpoint directory detection', () => {
    it('detects existing checkpoint directory for the issue', async () => {
      vi.mocked(fsUtils.exists).mockImplementation(async (p) =>
        String(p).endsWith(`issues/${ISSUE_NUMBER}`),
      );

      const result = await checkStaleState([ISSUE_NUMBER], BASE_CONFIG, makeProvider(), makeGit());

      expect(result.hasConflicts).toBe(true);
      const conflicts = result.conflicts.get(ISSUE_NUMBER);
      expect(conflicts?.some((c) => c.kind === 'checkpoint-dir')).toBe(true);
    });
  });

  describe('collect-all behaviour', () => {
    it('reports all four conflict kinds for a single issue even when they all fire', async () => {
      // All exists() calls return true
      vi.mocked(fsUtils.exists).mockResolvedValue(true);
      const lsRemoteOutput = `abc123\trefs/heads/${EXPECTED_BRANCH}\n`;
      const pr: PullRequestInfo = {
        number: 3,
        url: 'https://github.com/owner/repo/pull/3',
        title: 'Stale PR',
        headBranch: EXPECTED_BRANCH,
        baseBranch: 'main',
        state: 'open',
      };

      const result = await checkStaleState(
        [ISSUE_NUMBER],
        BASE_CONFIG,
        makeProvider([pr]),
        makeGit(lsRemoteOutput),
      );

      expect(result.hasConflicts).toBe(true);
      const conflicts = result.conflicts.get(ISSUE_NUMBER);
      expect(conflicts?.map((c) => c.kind)).toEqual(
        expect.arrayContaining(['worktree', 'remote-branch', 'open-pr', 'checkpoint-dir']),
      );
    });

    it('checks every issue in the batch even when the first one has conflicts', async () => {
      // Only issue 1 has a remote branch
      const git = {
        raw: vi.fn().mockImplementation(async (args: string[]) => {
          const ref = args[2] ?? '';
          return ref.includes('issue-1') ? 'abc\trefs/heads/cadre/issue-1\n' : '';
        }),
      } as unknown as SimpleGit;

      const result = await checkStaleState([1, 2], BASE_CONFIG, makeProvider(), git);

      expect(result.conflicts.has(1)).toBe(true);
      expect(result.conflicts.has(2)).toBe(false);
    });
  });
});
