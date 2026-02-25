import { describe, it, expect, vi, beforeEach } from 'vitest';
import { checkStaleState, resolveStaleState } from '../../src/validation/stale-state-validator.js';
import type { StaleConflict, StaleStateResult } from '../../src/validation/stale-state-validator.js';
import type { RuntimeConfig } from '../../src/config/loader.js';
import type { PlatformProvider } from '../../src/platform/provider.js';
import type { SimpleGit } from 'simple-git';

vi.mock('../../src/util/fs.js', () => ({
  exists: vi.fn().mockResolvedValue(false),
}));

import { exists } from '../../src/util/fs.js';
const mockExists = exists as ReturnType<typeof vi.fn>;

function makeConfig(overrides: Partial<RuntimeConfig> = {}): RuntimeConfig {
  return {
    worktreeRoot: '/tmp/worktrees',
    stateDir: '/tmp/.cadre/state',
    branchTemplate: 'cadre/issue-{issue}',
    ...overrides,
  } as RuntimeConfig;
}

function makeProvider(overrides: Partial<PlatformProvider> = {}): PlatformProvider {
  return {
    listPullRequests: vi.fn().mockResolvedValue([]),
    ...overrides,
  } as unknown as PlatformProvider;
}

function makeGit(overrides: Partial<SimpleGit> = {}): SimpleGit {
  return {
    raw: vi.fn().mockResolvedValue(''),
    ...overrides,
  } as unknown as SimpleGit;
}

describe('checkStaleState', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExists.mockResolvedValue(false);
  });

  it('should return hasConflicts=false and empty conflicts map when no state exists', async () => {
    const result = await checkStaleState([42], makeConfig(), makeProvider(), makeGit());
    expect(result.hasConflicts).toBe(false);
    expect(result.conflicts.size).toBe(0);
  });

  it('should detect a local worktree conflict', async () => {
    mockExists.mockImplementation((path: string) =>
      Promise.resolve(path.includes('issue-42')),
    );

    const result = await checkStaleState([42], makeConfig(), makeProvider(), makeGit());

    expect(result.hasConflicts).toBe(true);
    expect(result.conflicts.has(42)).toBe(true);
    const conflicts = result.conflicts.get(42)!;
    expect(conflicts.some((c: StaleConflict) => c.kind === 'worktree')).toBe(true);
  });

  it('should include the worktree path in the worktree conflict description', async () => {
    mockExists.mockImplementation((path: string) =>
      Promise.resolve(path === '/tmp/worktrees/issue-42'),
    );

    const result = await checkStaleState([42], makeConfig(), makeProvider(), makeGit());
    const conflict = result.conflicts.get(42)!.find((c: StaleConflict) => c.kind === 'worktree')!;
    expect(conflict.description).toContain('/tmp/worktrees/issue-42');
  });

  it('should detect a remote-branch conflict when ls-remote returns output', async () => {
    const git = makeGit({ raw: vi.fn().mockResolvedValue('abc123\trefs/heads/cadre/issue-42\n') });

    const result = await checkStaleState([42], makeConfig(), makeProvider(), git);

    expect(result.hasConflicts).toBe(true);
    const conflicts = result.conflicts.get(42)!;
    expect(conflicts.some((c: StaleConflict) => c.kind === 'remote-branch')).toBe(true);
  });

  it('should not detect a remote-branch conflict when ls-remote returns empty string', async () => {
    const git = makeGit({ raw: vi.fn().mockResolvedValue('') });

    const result = await checkStaleState([42], makeConfig(), makeProvider(), git);

    expect(result.hasConflicts).toBe(false);
  });

  it('should detect an open-pr conflict when provider returns PRs', async () => {
    const provider = makeProvider({
      listPullRequests: vi.fn().mockResolvedValue([{ number: 99, headBranch: 'cadre/issue-42', state: 'open' }]),
    });

    const result = await checkStaleState([42], makeConfig(), provider, makeGit());

    expect(result.hasConflicts).toBe(true);
    const conflicts = result.conflicts.get(42)!;
    expect(conflicts.some((c: StaleConflict) => c.kind === 'open-pr')).toBe(true);
  });

  it('should include PR number in the open-pr conflict description', async () => {
    const provider = makeProvider({
      listPullRequests: vi.fn().mockResolvedValue([{ number: 99, headBranch: 'cadre/issue-42', state: 'open' }]),
    });

    const result = await checkStaleState([42], makeConfig(), provider, makeGit());
    const conflict = result.conflicts.get(42)!.find((c: StaleConflict) => c.kind === 'open-pr')!;
    expect(conflict.description).toContain('99');
  });

  it('should detect a checkpoint-dir conflict', async () => {
    mockExists.mockImplementation((path: string) =>
      Promise.resolve(path.includes('issues/42')),
    );

    const result = await checkStaleState([42], makeConfig(), makeProvider(), makeGit());

    expect(result.hasConflicts).toBe(true);
    const conflicts = result.conflicts.get(42)!;
    expect(conflicts.some((c: StaleConflict) => c.kind === 'checkpoint-dir')).toBe(true);
  });

  it('should include the checkpoint path in the checkpoint-dir conflict description', async () => {
    mockExists.mockImplementation((path: string) =>
      Promise.resolve(path === '/tmp/.cadre/state/issues/42'),
    );

    const result = await checkStaleState([42], makeConfig(), makeProvider(), makeGit());
    const conflict = result.conflicts.get(42)!.find((c: StaleConflict) => c.kind === 'checkpoint-dir')!;
    expect(conflict.description).toContain('/tmp/.cadre/state/issues/42');
  });

  it('should collect all four conflict kinds for a single issue', async () => {
    mockExists.mockResolvedValue(true);
    const git = makeGit({ raw: vi.fn().mockResolvedValue('abc123\trefs/heads/cadre/issue-42\n') });
    const provider = makeProvider({
      listPullRequests: vi.fn().mockResolvedValue([{ number: 99, headBranch: 'cadre/issue-42', state: 'open' }]),
    });

    const result = await checkStaleState([42], makeConfig(), provider, git);
    const kinds = result.conflicts.get(42)!.map((c: StaleConflict) => c.kind);
    expect(kinds).toContain('worktree');
    expect(kinds).toContain('remote-branch');
    expect(kinds).toContain('open-pr');
    expect(kinds).toContain('checkpoint-dir');
  });

  it('should check all issues regardless of earlier conflicts (collect-all behaviour)', async () => {
    mockExists.mockImplementation((path: string) =>
      Promise.resolve(path.includes('issue-1')),
    );

    const result = await checkStaleState([1, 2], makeConfig(), makeProvider(), makeGit());

    expect(result.conflicts.has(1)).toBe(true);
    // Issue 2 should still be checked — no conflict expected
    expect(result.conflicts.has(2)).toBe(false);
  });

  it('should fail open when git.raw throws (no conflict added)', async () => {
    const git = makeGit({ raw: vi.fn().mockRejectedValue(new Error('network error')) });

    const result = await checkStaleState([42], makeConfig(), makeProvider(), git);

    const conflicts = result.conflicts.get(42);
    expect(conflicts?.some((c: StaleConflict) => c.kind === 'remote-branch')).toBeFalsy();
  });

  it('should fail open when provider.listPullRequests throws (no conflict added)', async () => {
    const provider = makeProvider({
      listPullRequests: vi.fn().mockRejectedValue(new Error('provider error')),
    });

    const result = await checkStaleState([42], makeConfig(), provider, makeGit());

    const conflicts = result.conflicts.get(42);
    expect(conflicts?.some((c: StaleConflict) => c.kind === 'open-pr')).toBeFalsy();
  });

  it('should handle multiple issues and map conflicts by issue number', async () => {
    mockExists.mockImplementation((path: string) =>
      Promise.resolve(path.includes('issue-10') || path.includes('issues/20')),
    );

    const result = await checkStaleState([10, 20], makeConfig(), makeProvider(), makeGit());

    expect(result.conflicts.has(10)).toBe(true);
    expect(result.conflicts.get(10)!.some((c: StaleConflict) => c.kind === 'worktree')).toBe(true);
    expect(result.conflicts.has(20)).toBe(true);
    expect(result.conflicts.get(20)!.some((c: StaleConflict) => c.kind === 'checkpoint-dir')).toBe(true);
  });

  it('should use the branchTemplate to build branch names', async () => {
    const git = makeGit({ raw: vi.fn() });
    (git.raw as ReturnType<typeof vi.fn>).mockResolvedValue('abc\trefs/heads/feature/issue-42\n');

    const config = makeConfig({ branchTemplate: 'feature/issue-{issue}' });
    await checkStaleState([42], config, makeProvider(), git);

    expect(git.raw).toHaveBeenCalledWith(['ls-remote', 'origin', 'refs/heads/feature/issue-42']);
  });

  it('should call provider.listPullRequests with the correct branch name and state=open', async () => {
    const provider = makeProvider({ listPullRequests: vi.fn().mockResolvedValue([]) });

    await checkStaleState([42], makeConfig(), provider, makeGit());

    expect(provider.listPullRequests).toHaveBeenCalledWith({ head: 'cadre/issue-42', state: 'open' });
  });

  it('should return a StaleStateResult with the correct shape', async () => {
    const result = await checkStaleState([1], makeConfig(), makeProvider(), makeGit());
    expect(typeof result.hasConflicts).toBe('boolean');
    expect(result.conflicts).toBeInstanceOf(Map);
  });
});

describe('resolveStaleState', () => {
  it('should throw an error indicating it is not yet implemented', async () => {
    const result: StaleStateResult = { hasConflicts: false, conflicts: new Map() };
    await expect(resolveStaleState(result, makeConfig())).rejects.toThrow(
      'Interactive stale-state resolution is not yet implemented',
    );
  });

  it('should reject with an Error instance', async () => {
    const result: StaleStateResult = { hasConflicts: false, conflicts: new Map() };
    await expect(resolveStaleState(result, makeConfig())).rejects.toBeInstanceOf(Error);
  });
});
