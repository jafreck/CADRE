import { describe, it, expect, vi } from 'vitest';
import type { PhaseCallbacks, PhaseContext, PhaseExecutor } from '../src/core/phase-executor.js';
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
      platform: {} as never,
      services: {
        launcher: {} as never,
        retryExecutor: {} as never,
        tokenTracker: {} as never,
        contextBuilder: {} as never,
        resultParser: {} as never,
        logger: {} as never,
      },
      io: {
        progressDir: '/tmp/progress',
        progressWriter: {} as never,
        checkpoint: {} as never,
        commitManager: {} as never,
      },
      callbacks: {
        recordTokens: vi.fn(),
        checkBudget: vi.fn(),
        updateProgress: vi.fn().mockResolvedValue(undefined),
      },
    };

    expect(ctx.io.progressDir).toBe('/tmp/progress');
    expect(ctx.issue.number).toBe(42);
    expect(typeof ctx.callbacks.recordTokens).toBe('function');
    expect(typeof ctx.callbacks.checkBudget).toBe('function');
  });

  it('recordTokens should accept agent name and nullable token count', () => {
    const recordTokens = vi.fn();
    const ctx: PhaseContext = {
      issue: {} as never,
      worktree: {} as never,
      config: {} as never,
      platform: {} as never,
      services: {
        launcher: {} as never,
        retryExecutor: {} as never,
        tokenTracker: {} as never,
        contextBuilder: {} as never,
        resultParser: {} as never,
        logger: {} as never,
      },
      io: {
        progressDir: '',
        progressWriter: {} as never,
        checkpoint: {} as never,
        commitManager: {} as never,
      },
      callbacks: {
        recordTokens,
        checkBudget: vi.fn(),
        updateProgress: vi.fn().mockResolvedValue(undefined),
      },
    };

    ctx.callbacks.recordTokens('issue-analyst', 1500);
    ctx.callbacks.recordTokens('code-writer', null);

    expect(recordTokens).toHaveBeenCalledWith('issue-analyst', 1500);
    expect(recordTokens).toHaveBeenCalledWith('code-writer', null);
  });

  it('should accept PhaseCallbacks without onPRCreated (it is optional)', () => {
    const callbacks: PhaseCallbacks = {
      recordTokens: vi.fn(),
      checkBudget: vi.fn(),
      updateProgress: vi.fn().mockResolvedValue(undefined),
    };
    expect(callbacks.onPRCreated).toBeUndefined();
  });

  it('should accept PhaseCallbacks with onPRCreated defined', () => {
    const onPRCreated = vi.fn();
    const callbacks: PhaseCallbacks = {
      recordTokens: vi.fn(),
      checkBudget: vi.fn(),
      updateProgress: vi.fn().mockResolvedValue(undefined),
      onPRCreated,
    };
    expect(typeof callbacks.onPRCreated).toBe('function');
  });

  it('onPRCreated should be called with PullRequestInfo when provided', () => {
    const onPRCreated = vi.fn();
    const callbacks: PhaseCallbacks = {
      recordTokens: vi.fn(),
      checkBudget: vi.fn(),
      updateProgress: vi.fn().mockResolvedValue(undefined),
      onPRCreated,
    };

    const pr: PullRequestInfo = {
      number: 99,
      url: 'https://github.com/owner/repo/pull/99',
      title: 'Fix: resolve edge case',
      headBranch: 'cadre/issue-42',
      baseBranch: 'main',
    };

    callbacks.onPRCreated!(pr);
    expect(onPRCreated).toHaveBeenCalledOnce();
    expect(onPRCreated).toHaveBeenCalledWith(pr);
  });

  it('onPRCreated should receive full PullRequestInfo fields', () => {
    const received: PullRequestInfo[] = [];
    const callbacks: PhaseCallbacks = {
      recordTokens: vi.fn(),
      checkBudget: vi.fn(),
      updateProgress: vi.fn().mockResolvedValue(undefined),
      onPRCreated: (pr) => received.push(pr),
    };

    const pr: PullRequestInfo = {
      number: 7,
      url: 'https://github.com/owner/repo/pull/7',
      title: 'Add feature',
      headBranch: 'cadre/issue-7',
      baseBranch: 'main',
    };

    callbacks.onPRCreated!(pr);
    expect(received).toHaveLength(1);
    expect(received[0].number).toBe(7);
    expect(received[0].url).toBe('https://github.com/owner/repo/pull/7');
    expect(received[0].headBranch).toBe('cadre/issue-7');
  });

  it('PhaseContext callbacks should work without onPRCreated', () => {
    const ctx: PhaseContext = {
      issue: {} as never,
      worktree: {} as never,
      config: {} as never,
      platform: {} as never,
      services: {
        launcher: {} as never,
        retryExecutor: {} as never,
        tokenTracker: {} as never,
        contextBuilder: {} as never,
        resultParser: {} as never,
        logger: {} as never,
      },
      io: {
        progressDir: '',
        progressWriter: {} as never,
        checkpoint: {} as never,
        commitManager: {} as never,
      },
      callbacks: {
        recordTokens: vi.fn(),
        checkBudget: vi.fn(),
        updateProgress: vi.fn().mockResolvedValue(undefined),
        // no onPRCreated
      },
    };
    expect(ctx.callbacks.onPRCreated).toBeUndefined();
  });

  it('checkBudget should be callable with no arguments', () => {
    const checkBudget = vi.fn();
    const ctx: PhaseContext = {
      issue: {} as never,
      worktree: {} as never,
      config: {} as never,
      platform: {} as never,
      services: {
        launcher: {} as never,
        retryExecutor: {} as never,
        tokenTracker: {} as never,
        contextBuilder: {} as never,
        resultParser: {} as never,
        logger: {} as never,
      },
      io: {
        progressDir: '',
        progressWriter: {} as never,
        checkpoint: {} as never,
        commitManager: {} as never,
      },
      callbacks: {
        recordTokens: vi.fn(),
        checkBudget,
        updateProgress: vi.fn().mockResolvedValue(undefined),
      },
    };

    ctx.callbacks.checkBudget();
    expect(checkBudget).toHaveBeenCalledOnce();
  });
});
