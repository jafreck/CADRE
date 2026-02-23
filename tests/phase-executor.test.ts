import { describe, it, expect, vi } from 'vitest';
import type { PhaseContext, PhaseExecutor } from '../src/core/phase-executor.js';
import type { PullRequestInfo } from '../src/platform/provider.js';

// ── PhaseExecutor interface ──

describe('PhaseExecutor', () => {
  it('should accept an object with phaseId, name, and execute', () => {
    const executor: PhaseExecutor = {
      phaseId: 1,
      name: 'Test Phase',
      execute: vi.fn().mockResolvedValue('/output/path.md'),
    };

    expect(executor.phaseId).toBe(1);
    expect(executor.name).toBe('Test Phase');
    expect(typeof executor.execute).toBe('function');
  });

  it('should allow execute to return a Promise<string>', async () => {
    const executor: PhaseExecutor = {
      phaseId: 2,
      name: 'Another Phase',
      execute: vi.fn().mockResolvedValue('/some/output.md'),
    };

    const result = await executor.execute({} as PhaseContext);
    expect(result).toBe('/some/output.md');
  });

  it('should allow phaseId to be any positive number', () => {
    const executors: PhaseExecutor[] = [1, 2, 3, 4, 5].map((id) => ({
      phaseId: id,
      name: `Phase ${id}`,
      execute: vi.fn().mockResolvedValue(`/output/phase-${id}.md`),
    }));

    executors.forEach((e, i) => {
      expect(e.phaseId).toBe(i + 1);
    });
  });

  it('execute should propagate errors from the implementation', async () => {
    const executor: PhaseExecutor = {
      phaseId: 3,
      name: 'Failing Phase',
      execute: vi.fn().mockRejectedValue(new Error('phase failed')),
    };

    await expect(executor.execute({} as PhaseContext)).rejects.toThrow('phase failed');
  });
});

// ── PhaseContext type ──

describe('PhaseContext', () => {
  it('should accept an object with all required dependency fields', () => {
    const ctx: PhaseContext = {
      issue: {
        number: 42,
        title: 'Test issue',
        body: 'Test body',
        labels: [],
        assignees: [],
        state: 'open',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        url: 'https://github.com/owner/repo/issues/42',
      },
      worktree: { path: '/tmp/worktree', branch: 'cadre/issue-42', baseCommit: 'abc123', issueNumber: 42 } as never,
      config: {} as never,
      progressDir: '/tmp/progress',
      contextBuilder: {} as never,
      launcher: {} as never,
      resultParser: {} as never,
      checkpoint: {} as never,
      commitManager: {} as never,
      retryExecutor: {} as never,
      tokenTracker: {} as never,
      progressWriter: {} as never,
      platform: {} as never,
      recordTokens: vi.fn(),
      checkBudget: vi.fn(),
      setPR: vi.fn(),
      logger: {} as never,
    };

    expect(ctx.progressDir).toBe('/tmp/progress');
    expect(ctx.issue.number).toBe(42);
    expect(typeof ctx.recordTokens).toBe('function');
    expect(typeof ctx.checkBudget).toBe('function');
    expect(typeof ctx.setPR).toBe('function');
  });

  it('recordTokens should accept agent name and nullable token count', () => {
    const recordTokens = vi.fn();
    const ctx: PhaseContext = {
      issue: {} as never,
      worktree: {} as never,
      config: {} as never,
      progressDir: '',
      contextBuilder: {} as never,
      launcher: {} as never,
      resultParser: {} as never,
      checkpoint: {} as never,
      commitManager: {} as never,
      retryExecutor: {} as never,
      tokenTracker: {} as never,
      progressWriter: {} as never,
      platform: {} as never,
      recordTokens,
      checkBudget: vi.fn(),
      setPR: vi.fn(),
      logger: {} as never,
    };

    ctx.recordTokens('issue-analyst', 1500);
    ctx.recordTokens('code-writer', null);

    expect(recordTokens).toHaveBeenCalledWith('issue-analyst', 1500);
    expect(recordTokens).toHaveBeenCalledWith('code-writer', null);
  });

  it('checkBudget should be callable with no arguments', () => {
    const checkBudget = vi.fn();
    const ctx: PhaseContext = {
      issue: {} as never,
      worktree: {} as never,
      config: {} as never,
      progressDir: '',
      contextBuilder: {} as never,
      launcher: {} as never,
      resultParser: {} as never,
      checkpoint: {} as never,
      commitManager: {} as never,
      retryExecutor: {} as never,
      tokenTracker: {} as never,
      progressWriter: {} as never,
      platform: {} as never,
      recordTokens: vi.fn(),
      checkBudget,
      setPR: vi.fn(),
      logger: {} as never,
    };

    ctx.checkBudget();
    expect(checkBudget).toHaveBeenCalledOnce();
  });

  it('setPR should accept a PullRequestInfo and be callable', () => {
    const setPR = vi.fn();
    const ctx: PhaseContext = {
      issue: {} as never,
      worktree: {} as never,
      config: {} as never,
      progressDir: '',
      contextBuilder: {} as never,
      launcher: {} as never,
      resultParser: {} as never,
      checkpoint: {} as never,
      commitManager: {} as never,
      retryExecutor: {} as never,
      tokenTracker: {} as never,
      progressWriter: {} as never,
      platform: {} as never,
      recordTokens: vi.fn(),
      checkBudget: vi.fn(),
      setPR,
      logger: {} as never,
    };

    const pr: PullRequestInfo = {
      number: 99,
      url: 'https://github.com/owner/repo/pull/99',
      title: 'feat: add setPR callback',
      headBranch: 'cadre/issue-47',
      baseBranch: 'main',
    };

    ctx.setPR(pr);
    expect(setPR).toHaveBeenCalledOnce();
    expect(setPR).toHaveBeenCalledWith(pr);
  });

  it('setPR should be called with full PullRequestInfo shape', () => {
    const setPR = vi.fn();
    const ctx: PhaseContext = {
      issue: {} as never,
      worktree: {} as never,
      config: {} as never,
      progressDir: '',
      contextBuilder: {} as never,
      launcher: {} as never,
      resultParser: {} as never,
      checkpoint: {} as never,
      commitManager: {} as never,
      retryExecutor: {} as never,
      tokenTracker: {} as never,
      progressWriter: {} as never,
      platform: {} as never,
      recordTokens: vi.fn(),
      checkBudget: vi.fn(),
      setPR,
      logger: {} as never,
    };

    const pr: PullRequestInfo = {
      number: 1,
      url: 'https://github.com/org/project/pull/1',
      title: 'PR title',
      headBranch: 'feature/branch',
      baseBranch: 'main',
    };

    ctx.setPR(pr);
    const received = setPR.mock.calls[0][0] as PullRequestInfo;
    expect(received.number).toBe(1);
    expect(received.url).toBe('https://github.com/org/project/pull/1');
    expect(received.title).toBe('PR title');
    expect(received.headBranch).toBe('feature/branch');
    expect(received.baseBranch).toBe('main');
  });

  it('setPR can be called multiple times, recording each call', () => {
    const setPR = vi.fn();
    const ctx: PhaseContext = {
      issue: {} as never,
      worktree: {} as never,
      config: {} as never,
      progressDir: '',
      contextBuilder: {} as never,
      launcher: {} as never,
      resultParser: {} as never,
      checkpoint: {} as never,
      commitManager: {} as never,
      retryExecutor: {} as never,
      tokenTracker: {} as never,
      progressWriter: {} as never,
      platform: {} as never,
      recordTokens: vi.fn(),
      checkBudget: vi.fn(),
      setPR,
      logger: {} as never,
    };

    const pr1: PullRequestInfo = { number: 10, url: 'u1', title: 't1', headBranch: 'b1', baseBranch: 'main' };
    const pr2: PullRequestInfo = { number: 20, url: 'u2', title: 't2', headBranch: 'b2', baseBranch: 'main' };

    ctx.setPR(pr1);
    ctx.setPR(pr2);
    expect(setPR).toHaveBeenCalledTimes(2);
    expect(setPR).toHaveBeenNthCalledWith(1, pr1);
    expect(setPR).toHaveBeenNthCalledWith(2, pr2);
  });
});
