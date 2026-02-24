import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FleetOrchestrator } from '../src/core/fleet-orchestrator.js';
import { NotificationManager } from '../src/notifications/manager.js';
import { RemoteBranchMissingError } from '../src/git/worktree.js';
import { makeRuntimeConfig } from './helpers/make-runtime-config.js';
import type { RuntimeConfig } from '../src/config/loader.js';
import type { IssueDetail } from '../src/platform/provider.js';

// Mock heavy dependencies to keep tests fast and isolated
vi.mock('../src/core/review-response-orchestrator.js', () => ({
  ReviewResponseOrchestrator: vi.fn().mockImplementation(() => ({
    run: vi.fn().mockResolvedValue({
      processed: 1,
      skipped: 0,
      succeeded: 1,
      failed: 0,
      issues: [
        {
          issueNumber: 1,
          skipped: false,
          result: {
            issueNumber: 1,
            issueTitle: 'Test issue',
            success: true,
            phases: [],
            totalDuration: 100,
            tokenUsage: 500,
          },
        },
      ],
    }),
  })),
}));
vi.mock('../src/git/worktree.js', () => {
  class RemoteBranchMissingError extends Error {
    constructor(branch: string) {
      super(`Remote branch '${branch}' is missing`);
      this.name = 'RemoteBranchMissingError';
    }
  }
  return {
    WorktreeManager: vi.fn(),
    RemoteBranchMissingError,
  };
});
vi.mock('../src/core/agent-launcher.js', () => ({
  AgentLauncher: vi.fn(),
}));
vi.mock('../src/core/checkpoint.js', () => ({
  CheckpointManager: vi.fn().mockImplementation(() => ({
    load: vi.fn().mockResolvedValue({}),
    setWorktreeInfo: vi.fn().mockResolvedValue(undefined),
    startPhase: vi.fn().mockResolvedValue(undefined),
    completePhase: vi.fn().mockResolvedValue(undefined),
  })),
  FleetCheckpointManager: vi.fn().mockImplementation(() => ({
    load: vi.fn().mockResolvedValue(undefined),
    isIssueCompleted: vi.fn().mockReturnValue(false),
    setIssueStatus: vi.fn().mockResolvedValue(undefined),
    recordTokenUsage: vi.fn().mockResolvedValue(undefined),
    getIssueStatus: vi.fn().mockReturnValue(null),
  })),
}));
vi.mock('../src/core/progress.js', () => ({
  FleetProgressWriter: vi.fn().mockImplementation(() => ({
    write: vi.fn().mockResolvedValue(undefined),
    appendEvent: vi.fn().mockResolvedValue(undefined),
  })),
  IssueProgressWriter: vi.fn(),
}));
vi.mock('../src/core/issue-orchestrator.js', () => ({
  IssueOrchestrator: vi.fn().mockImplementation(() => ({
    run: vi.fn().mockResolvedValue({
      issueNumber: 1,
      issueTitle: 'Test issue',
      success: true,
      phases: [],
      totalDuration: 100,
      tokenUsage: 500,
    }),
  })),
}));
vi.mock('../src/core/phase-registry.js', () => ({
  getPhaseCount: vi.fn().mockReturnValue(5),
}));
vi.mock('../src/logging/logger.js', () => ({
  Logger: vi.fn(),
}));

function makeConfig(overrides: Partial<RuntimeConfig['options']> = {}) {
  return makeRuntimeConfig({
    branchTemplate: 'cadre/issue-{issue}',
    issues: { ids: [1] },
    commits: { conventional: true, sign: false, commitPerPhase: true, squashBeforePR: false },
    pullRequest: { autoCreate: true, draft: true, labels: [], reviewers: [], linkIssue: true },
    options: {
      maxParallelIssues: 3,
      maxParallelAgents: 3,
      maxRetriesPerTask: 3,
      dryRun: false,
      resume: false,
      invocationDelayMs: 0,
      buildVerification: false,
      testVerification: false,
      perTaskBuildCheck: true,
      maxBuildFixRounds: 2,
      skipValidation: false,
      maxIntegrationFixRounds: 1,
      ambiguityThreshold: 5,
      haltOnAmbiguity: false,
      respondToReviews: false,
      ...overrides,
    },
  });
}

function makeIssue(number = 1): IssueDetail {
  return {
    number,
    title: `Issue ${number}`,
    body: '',
    labels: [],
    state: 'open',
    url: `https://github.com/owner/repo/issues/${number}`,
    author: 'user',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    comments: [],
  } as unknown as IssueDetail;
}

function makeMockDeps() {
  const worktreeManager = {
    prefetch: vi.fn().mockResolvedValue(undefined),
    provision: vi.fn().mockResolvedValue({
      path: '/tmp/worktree/1',
      branch: 'cadre/issue-1',
      baseCommit: 'abc123',
    }),
    resolveBranchName: vi.fn().mockReturnValue('cadre/issue-1'),
  };
  const launcher = {};
  const platform = {
    findOpenPR: vi.fn().mockResolvedValue(null),
  };
  const logger = {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    child: vi.fn().mockReturnThis(),
  };
  return { worktreeManager, launcher, platform, logger };
}

describe('FleetOrchestrator — prefetch', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls worktreeManager.prefetch() exactly once during run()', async () => {
    const config = makeConfig();
    const issues = [makeIssue(1), makeIssue(2)];
    const { worktreeManager, launcher, platform, logger } = makeMockDeps();
    const notifications = { dispatch: vi.fn().mockResolvedValue(undefined) } as any;

    const fleet = new FleetOrchestrator(
      config,
      issues,
      worktreeManager as any,
      launcher as any,
      platform as any,
      logger as any,
      notifications,
    );

    await fleet.run();

    expect(worktreeManager.prefetch).toHaveBeenCalledTimes(1);
  });

  it('calls prefetch() before any worktree is provisioned', async () => {
    const config = makeConfig();
    const issues = [makeIssue(1)];
    const { worktreeManager, launcher, platform, logger } = makeMockDeps();
    const notifications = { dispatch: vi.fn().mockResolvedValue(undefined) } as any;

    const callOrder: string[] = [];
    worktreeManager.prefetch.mockImplementation(async () => { callOrder.push('prefetch'); });
    worktreeManager.provision.mockImplementation(async () => {
      callOrder.push('provision');
      return { path: '/tmp/worktree/1', branch: 'cadre/issue-1', baseCommit: 'abc123' };
    });

    const fleet = new FleetOrchestrator(
      config,
      issues,
      worktreeManager as any,
      launcher as any,
      platform as any,
      logger as any,
      notifications,
    );

    await fleet.run();

    expect(callOrder.indexOf('prefetch')).toBeLessThan(callOrder.indexOf('provision'));
  });

  it('propagates error thrown by prefetch() without running any issue', async () => {
    const config = makeConfig();
    const issues = [makeIssue(1)];
    const { worktreeManager, launcher, platform, logger } = makeMockDeps();
    const notifications = { dispatch: vi.fn().mockResolvedValue(undefined) } as any;

    worktreeManager.prefetch.mockRejectedValue(new Error('network failure'));

    const fleet = new FleetOrchestrator(
      config,
      issues,
      worktreeManager as any,
      launcher as any,
      platform as any,
      logger as any,
      notifications,
    );

    await expect(fleet.run()).rejects.toThrow('network failure');
    expect(worktreeManager.provision).not.toHaveBeenCalled();
  });

  it('calls prefetch() exactly once when maxParallelIssues: 3 and 3 issues run concurrently', async () => {
    const config = makeConfig({ maxParallelIssues: 3 });
    const issues = [makeIssue(1), makeIssue(2), makeIssue(3)];
    const { worktreeManager, launcher, platform, logger } = makeMockDeps();
    const notifications = { dispatch: vi.fn().mockResolvedValue(undefined) } as any;

    const fleet = new FleetOrchestrator(
      config,
      issues,
      worktreeManager as any,
      launcher as any,
      platform as any,
      logger as any,
      notifications,
    );

    await fleet.run();

    expect(worktreeManager.prefetch).toHaveBeenCalledTimes(1);
  });

  it('still calls prefetch() once when issue list is empty', async () => {
    const config = makeConfig();
    const issues: IssueDetail[] = [];
    const { worktreeManager, launcher, platform, logger } = makeMockDeps();
    const notifications = { dispatch: vi.fn().mockResolvedValue(undefined) } as any;

    const fleet = new FleetOrchestrator(
      config,
      issues,
      worktreeManager as any,
      launcher as any,
      platform as any,
      logger as any,
      notifications,
    );

    await fleet.run();

    expect(worktreeManager.prefetch).toHaveBeenCalledTimes(1);
  });
});

describe('FleetOrchestrator — NotificationManager integration', () => {
  let dispatchSpy: ReturnType<typeof vi.fn>;
  let notifications: NotificationManager;

  beforeEach(() => {
    vi.clearAllMocks();
    dispatchSpy = vi.fn().mockResolvedValue(undefined);
    notifications = { dispatch: dispatchSpy } as unknown as NotificationManager;
  });

  it('dispatches fleet-started with issueCount and maxParallel at the start of run()', async () => {
    const config = makeConfig({ maxParallelIssues: 2 });
    const issues = [makeIssue(1), makeIssue(2)];
    const { worktreeManager, launcher, platform, logger } = makeMockDeps();

    const fleet = new FleetOrchestrator(
      config,
      issues,
      worktreeManager as any,
      launcher as any,
      platform as any,
      logger as any,
      notifications,
    );

    await fleet.run();

    const fleetStartedCall = dispatchSpy.mock.calls.find(
      ([e]) => e.type === 'fleet-started',
    );
    expect(fleetStartedCall).toBeDefined();
    const [event] = fleetStartedCall!;
    expect(event).toMatchObject({
      type: 'fleet-started',
      issueCount: 2,
      maxParallel: 2,
    });
  });

  it('dispatches fleet-completed with summary fields at the end of run()', async () => {
    const config = makeConfig();
    const issues = [makeIssue(1)];
    const { worktreeManager, launcher, platform, logger } = makeMockDeps();

    const fleet = new FleetOrchestrator(
      config,
      issues,
      worktreeManager as any,
      launcher as any,
      platform as any,
      logger as any,
      notifications,
    );

    await fleet.run();

    const fleetCompletedCall = dispatchSpy.mock.calls.find(
      ([e]) => e.type === 'fleet-completed',
    );
    expect(fleetCompletedCall).toBeDefined();
    const [event] = fleetCompletedCall!;
    expect(event).toMatchObject({
      type: 'fleet-completed',
      success: true,
      prsCreated: expect.any(Number),
      failedIssues: expect.any(Number),
      totalDuration: expect.any(Number),
      totalTokens: expect.any(Number),
    });
  });

  it('dispatches fleet-started before fleet-completed', async () => {
    const config = makeConfig();
    const issues = [makeIssue(1)];
    const { worktreeManager, launcher, platform, logger } = makeMockDeps();

    const fleet = new FleetOrchestrator(
      config,
      issues,
      worktreeManager as any,
      launcher as any,
      platform as any,
      logger as any,
      notifications,
    );

    await fleet.run();

    const types = dispatchSpy.mock.calls.map(([e]) => e.type);
    const startedIdx = types.indexOf('fleet-started');
    const completedIdx = types.indexOf('fleet-completed');
    expect(startedIdx).toBeGreaterThanOrEqual(0);
    expect(completedIdx).toBeGreaterThan(startedIdx);
  });

  it('dispatches budget-exceeded when token budget is exceeded', async () => {
    const { IssueOrchestrator } = await import('../src/core/issue-orchestrator.js');
    (IssueOrchestrator as ReturnType<typeof vi.fn>).mockImplementationOnce(() => ({
      run: vi.fn().mockResolvedValue({
        issueNumber: 1,
        issueTitle: 'Test issue',
        success: true,
        phases: [],
        totalDuration: 100,
        tokenUsage: 500_000, // exceeds the 250k budget after recording
      }),
    }));

    const config = makeConfig({ tokenBudget: 250_000 }); // budget that passes pre-flight estimate but is exceeded by token usage
    const issues = [makeIssue(1)];
    const { worktreeManager, launcher, platform, logger } = makeMockDeps();

    const fleet = new FleetOrchestrator(
      config,
      issues,
      worktreeManager as any,
      launcher as any,
      platform as any,
      logger as any,
      notifications,
    );

    await fleet.run();

    const budgetExceededCall = dispatchSpy.mock.calls.find(
      ([e]) => e.type === 'budget-exceeded',
    );
    expect(budgetExceededCall).toBeDefined();
    const [event] = budgetExceededCall!;
    expect(event).toMatchObject({
      type: 'budget-exceeded',
      scope: 'fleet',
      budget: 250_000,
      currentUsage: expect.any(Number),
    });
  });

  it('dispatches budget-warning when token usage is between 80-100% of budget', async () => {
    const { IssueOrchestrator } = await import('../src/core/issue-orchestrator.js');
    (IssueOrchestrator as ReturnType<typeof vi.fn>).mockImplementationOnce(() => ({
      run: vi.fn().mockResolvedValue({
        issueNumber: 1,
        issueTitle: 'Test issue',
        success: true,
        phases: [],
        totalDuration: 100,
        tokenUsage: 225_000, // 90% of 250_000
      }),
    }));

    const config = makeConfig({ tokenBudget: 250_000 });
    const issues = [makeIssue(1)];
    const { worktreeManager, launcher, platform, logger } = makeMockDeps();

    const fleet = new FleetOrchestrator(
      config,
      issues,
      worktreeManager as any,
      launcher as any,
      platform as any,
      logger as any,
      notifications,
    );

    await fleet.run();

    const budgetWarningCall = dispatchSpy.mock.calls.find(
      ([e]) => e.type === 'budget-warning',
    );
    expect(budgetWarningCall).toBeDefined();
    const [event] = budgetWarningCall!;
    expect(event).toMatchObject({
      type: 'budget-warning',
      scope: 'fleet',
      budget: 250_000,
      currentUsage: expect.any(Number),
      percentUsed: expect.any(Number),
    });
    expect(event.percentUsed).toBeGreaterThanOrEqual(80);
    expect(event.percentUsed).toBeLessThan(100);
  });

  it('does not dispatch budget events when no budget is configured', async () => {
    const config = makeConfig({ tokenBudget: undefined });
    const issues = [makeIssue(1)];
    const { worktreeManager, launcher, platform, logger } = makeMockDeps();

    const fleet = new FleetOrchestrator(
      config,
      issues,
      worktreeManager as any,
      launcher as any,
      platform as any,
      logger as any,
      notifications,
    );

    await fleet.run();

    const budgetCalls = dispatchSpy.mock.calls.filter(([e]) =>
      e.type === 'budget-exceeded' || e.type === 'budget-warning',
    );
    expect(budgetCalls).toHaveLength(0);
  });

  it('works without a NotificationManager provided (backward compatibility)', async () => {
    const config = makeConfig();
    const issues = [makeIssue(1)];
    const { worktreeManager, launcher, platform, logger } = makeMockDeps();

    // No notifications argument — should use default (disabled) NotificationManager
    const fleet = new FleetOrchestrator(
      config,
      issues,
      worktreeManager as any,
      launcher as any,
      platform as any,
      logger as any,
      // notifications omitted
    );

    // Should complete without throwing
    await expect(fleet.run()).resolves.toBeDefined();
  });

  it('run() returns a FleetResult with correct shape', async () => {
    const config = makeConfig();
    const issues = [makeIssue(1)];
    const { worktreeManager, launcher, platform, logger } = makeMockDeps();

    const fleet = new FleetOrchestrator(
      config,
      issues,
      worktreeManager as any,
      launcher as any,
      platform as any,
      logger as any,
      notifications,
    );

    const result = await fleet.run();

    expect(result).toMatchObject({
      success: expect.any(Boolean),
      issues: expect.any(Array),
      prsCreated: expect.any(Array),
      codeDoneNoPR: expect.any(Array),
      failedIssues: expect.any(Array),
      totalDuration: expect.any(Number),
      tokenUsage: expect.objectContaining({
        total: expect.any(Number),
        byIssue: expect.any(Object),
        byAgent: expect.any(Object),
      }),
    });
  });
});

describe('FleetOrchestrator — runReviewResponse', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns a FleetResult with correct shape', async () => {
    const config = makeConfig();
    const issues = [makeIssue(1)];
    const { worktreeManager, launcher, platform, logger } = makeMockDeps();
    const notifications = { dispatch: vi.fn().mockResolvedValue(undefined) } as any;

    const fleet = new FleetOrchestrator(
      config,
      issues,
      worktreeManager as any,
      launcher as any,
      platform as any,
      logger as any,
      notifications,
    );

    const result = await fleet.runReviewResponse();

    expect(result).toMatchObject({
      success: expect.any(Boolean),
      issues: expect.any(Array),
      prsCreated: expect.any(Array),
      failedIssues: expect.any(Array),
      totalDuration: expect.any(Number),
      tokenUsage: expect.objectContaining({
        total: expect.any(Number),
      }),
    });
  });

  it('delegates to ReviewResponseOrchestrator.run() with provided issueNumbers', async () => {
    const { ReviewResponseOrchestrator } = await import('../src/core/review-response-orchestrator.js');
    const runMock = vi.fn().mockResolvedValue({
      processed: 0,
      skipped: 0,
      succeeded: 0,
      failed: 0,
      issues: [],
    });
    (ReviewResponseOrchestrator as ReturnType<typeof vi.fn>).mockImplementationOnce(() => ({
      run: runMock,
    }));

    const config = makeConfig();
    const issues = [makeIssue(1)];
    const { worktreeManager, launcher, platform, logger } = makeMockDeps();
    const notifications = { dispatch: vi.fn().mockResolvedValue(undefined) } as any;

    const fleet = new FleetOrchestrator(
      config,
      issues,
      worktreeManager as any,
      launcher as any,
      platform as any,
      logger as any,
      notifications,
    );

    await fleet.runReviewResponse([42, 43]);

    expect(runMock).toHaveBeenCalledWith([42, 43]);
  });

  it('maps succeeded issue results into FleetResult.issues', async () => {
    const config = makeConfig();
    const issues = [makeIssue(1)];
    const { worktreeManager, launcher, platform, logger } = makeMockDeps();
    const notifications = { dispatch: vi.fn().mockResolvedValue(undefined) } as any;

    const fleet = new FleetOrchestrator(
      config,
      issues,
      worktreeManager as any,
      launcher as any,
      platform as any,
      logger as any,
      notifications,
    );

    const result = await fleet.runReviewResponse();

    expect(result.issues).toHaveLength(1);
    expect(result.issues[0]).toMatchObject({ issueNumber: 1, success: true });
    expect(result.success).toBe(true);
    expect(result.failedIssues).toHaveLength(0);
  });

  it('marks result as failed when ReviewResponseOrchestrator reports failures', async () => {
    const { ReviewResponseOrchestrator } = await import('../src/core/review-response-orchestrator.js');
    (ReviewResponseOrchestrator as ReturnType<typeof vi.fn>).mockImplementationOnce(() => ({
      run: vi.fn().mockResolvedValue({
        processed: 1,
        skipped: 0,
        succeeded: 0,
        failed: 1,
        issues: [
          { issueNumber: 5, skipped: false, result: undefined },
        ],
      }),
    }));

    const config = makeConfig();
    const issues = [makeIssue(5)];
    const { worktreeManager, launcher, platform, logger } = makeMockDeps();
    const notifications = { dispatch: vi.fn().mockResolvedValue(undefined) } as any;

    const fleet = new FleetOrchestrator(
      config,
      issues,
      worktreeManager as any,
      launcher as any,
      platform as any,
      logger as any,
      notifications,
    );

    const result = await fleet.runReviewResponse([5]);

    expect(result.success).toBe(false);
    expect(result.failedIssues).toHaveLength(1);
    expect(result.failedIssues[0].issueNumber).toBe(5);
  });
});


describe('FleetOrchestrator — resume flag passed to provision()', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls provision() with resume: false when config.options.resume is false', async () => {
    const config = makeConfig({ resume: false });
    const issues = [makeIssue(1)];
    const { worktreeManager, launcher, platform, logger } = makeMockDeps();
    const notifications = { dispatch: vi.fn().mockResolvedValue(undefined) } as any;

    const fleet = new FleetOrchestrator(
      config,
      issues,
      worktreeManager as any,
      launcher as any,
      platform as any,
      logger as any,
      notifications,
    );

    await fleet.run();

    expect(worktreeManager.provision).toHaveBeenCalledWith(1, 'Issue 1', false);
  });

  it('calls provision() with resume: true when config.options.resume is true', async () => {
    const config = makeConfig({ resume: true });
    const issues = [makeIssue(2)];
    const { worktreeManager, launcher, platform, logger } = makeMockDeps();
    const notifications = { dispatch: vi.fn().mockResolvedValue(undefined) } as any;

    worktreeManager.provision.mockResolvedValue({
      path: '/tmp/worktree/2',
      branch: 'cadre/issue-2',
      baseCommit: 'def456',
    });

    const fleet = new FleetOrchestrator(
      config,
      issues,
      worktreeManager as any,
      launcher as any,
      platform as any,
      logger as any,
      notifications,
    );

    await fleet.run();

    expect(worktreeManager.provision).toHaveBeenCalledWith(2, 'Issue 2', true);
  });

  it('passes the resume flag for every issue when multiple issues are processed', async () => {
    const config = makeConfig({ resume: true, maxParallelIssues: 3 });
    const issues = [makeIssue(1), makeIssue(2), makeIssue(3)];
    const { worktreeManager, launcher, platform, logger } = makeMockDeps();
    const notifications = { dispatch: vi.fn().mockResolvedValue(undefined) } as any;

    const fleet = new FleetOrchestrator(
      config,
      issues,
      worktreeManager as any,
      launcher as any,
      platform as any,
      logger as any,
      notifications,
    );

    await fleet.run();

    expect(worktreeManager.provision).toHaveBeenCalledTimes(3);
    for (const call of worktreeManager.provision.mock.calls) {
      expect(call[2]).toBe(true);
    }
  });
});

describe('FleetOrchestrator — RemoteBranchMissingError handling', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('skips the issue and returns success: false when provision() throws RemoteBranchMissingError', async () => {
    const config = makeConfig();
    const issues = [makeIssue(1)];
    const { worktreeManager, launcher, platform, logger } = makeMockDeps();
    const notifications = { dispatch: vi.fn().mockResolvedValue(undefined) } as any;

    worktreeManager.provision.mockRejectedValue(new RemoteBranchMissingError('cadre/issue-1'));

    const fleet = new FleetOrchestrator(
      config,
      issues,
      worktreeManager as any,
      launcher as any,
      platform as any,
      logger as any,
      notifications,
    );

    const result = await fleet.run();

    expect(result.failedIssues).toHaveLength(1);
    expect(result.failedIssues[0].issueNumber).toBe(1);
    expect(result.failedIssues[0].error).toContain('remote branch is missing');
    expect(result.success).toBe(false);
  });

  it('continues processing other issues after one fails with RemoteBranchMissingError', async () => {
    const config = makeConfig({ maxParallelIssues: 2 });
    const issues = [makeIssue(1), makeIssue(2)];
    const { worktreeManager, launcher, platform, logger } = makeMockDeps();
    const notifications = { dispatch: vi.fn().mockResolvedValue(undefined) } as any;

    worktreeManager.provision
      .mockRejectedValueOnce(new RemoteBranchMissingError('cadre/issue-1'))
      .mockResolvedValueOnce({ path: '/tmp/worktree/2', branch: 'cadre/issue-2', baseCommit: 'abc' });

    const fleet = new FleetOrchestrator(
      config,
      issues,
      worktreeManager as any,
      launcher as any,
      platform as any,
      logger as any,
      notifications,
    );

    const result = await fleet.run();

    expect(result.failedIssues).toHaveLength(1);
    expect(result.failedIssues[0].issueNumber).toBe(1);
    expect(result.issues).toHaveLength(2);
    const anySucceeded = result.issues.some((i) => i.success === true);
    expect(anySucceeded).toBe(true);
  });

  it('logs a warning (not an error) when RemoteBranchMissingError is thrown', async () => {
    const config = makeConfig();
    const issues = [makeIssue(1)];
    const { worktreeManager, launcher, platform, logger } = makeMockDeps();
    const notifications = { dispatch: vi.fn().mockResolvedValue(undefined) } as any;

    worktreeManager.provision.mockRejectedValue(new RemoteBranchMissingError('cadre/issue-1'));

    const fleet = new FleetOrchestrator(
      config,
      issues,
      worktreeManager as any,
      launcher as any,
      platform as any,
      logger as any,
      notifications,
    );

    await fleet.run();

    expect(logger.warn).toHaveBeenCalled();
    const warnCall = (logger.warn as ReturnType<typeof vi.fn>).mock.calls.find(
      ([msg]: [string]) => typeof msg === 'string' && msg.includes('remote branch is missing'),
    );
    expect(warnCall).toBeDefined();
    const errorCall = (logger.error as ReturnType<typeof vi.fn>).mock.calls.find(
      ([msg]: [string]) => typeof msg === 'string' && msg.includes('#1'),
    );
    expect(errorCall).toBeUndefined();
  });

  it('includes issue number and descriptive message in the skipped result', async () => {
    const config = makeConfig();
    const issues = [makeIssue(42)];
    const { worktreeManager, launcher, platform, logger } = makeMockDeps();
    const notifications = { dispatch: vi.fn().mockResolvedValue(undefined) } as any;

    worktreeManager.provision.mockRejectedValue(new RemoteBranchMissingError('cadre/issue-42'));

    const fleet = new FleetOrchestrator(
      config,
      issues,
      worktreeManager as any,
      launcher as any,
      platform as any,
      logger as any,
      notifications,
    );

    const result = await fleet.run();

    const skippedIssue = result.issues.find((i) => i.issueNumber === 42);
    expect(skippedIssue).toBeDefined();
    expect(skippedIssue!.success).toBe(false);
    expect(skippedIssue!.error).toContain('42');
    expect(skippedIssue!.error).toContain('remote branch is missing');
  });

  it('does not skip issues when provision() succeeds normally', async () => {
    const config = makeConfig();
    const issues = [makeIssue(1)];
    const { worktreeManager, launcher, platform, logger } = makeMockDeps();
    const notifications = { dispatch: vi.fn().mockResolvedValue(undefined) } as any;

    const fleet = new FleetOrchestrator(
      config,
      issues,
      worktreeManager as any,
      launcher as any,
      platform as any,
      logger as any,
      notifications,
    );

    const result = await fleet.run();

    expect(result.issues).toHaveLength(1);
    expect(result.issues[0].success).toBe(true);
    expect(result.failedIssues).toHaveLength(0);
  });
});

describe('FleetOrchestrator — skip issues with existing open PRs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls resolveBranchName() with issue number and title before provision()', async () => {
    const config = makeConfig();
    const issues = [makeIssue(1)];
    const { worktreeManager, launcher, platform, logger } = makeMockDeps();
    const notifications = { dispatch: vi.fn().mockResolvedValue(undefined) } as any;

    const fleet = new FleetOrchestrator(
      config,
      issues,
      worktreeManager as any,
      launcher as any,
      platform as any,
      logger as any,
      notifications,
    );

    await fleet.run();

    expect(worktreeManager.resolveBranchName).toHaveBeenCalledWith(1, 'Issue 1');
  });

  it('calls resolveBranchName() before provision()', async () => {
    const config = makeConfig();
    const issues = [makeIssue(1)];
    const { worktreeManager, launcher, platform, logger } = makeMockDeps();
    const notifications = { dispatch: vi.fn().mockResolvedValue(undefined) } as any;

    const callOrder: string[] = [];
    worktreeManager.resolveBranchName.mockImplementation(() => {
      callOrder.push('resolveBranchName');
      return 'cadre/issue-1';
    });
    worktreeManager.provision.mockImplementation(async () => {
      callOrder.push('provision');
      return { path: '/tmp/worktree/1', branch: 'cadre/issue-1', baseCommit: 'abc123' };
    });

    const fleet = new FleetOrchestrator(
      config,
      issues,
      worktreeManager as any,
      launcher as any,
      platform as any,
      logger as any,
      notifications,
    );

    await fleet.run();

    expect(callOrder.indexOf('resolveBranchName')).toBeLessThan(callOrder.indexOf('provision'));
  });

  it('skips provisioning when findOpenPR() returns a non-null PR', async () => {
    const config = makeConfig();
    const issues = [makeIssue(1)];
    const { worktreeManager, launcher, platform, logger } = makeMockDeps();
    const notifications = { dispatch: vi.fn().mockResolvedValue(undefined) } as any;

    const existingPR = { number: 42, url: 'https://github.com/owner/repo/pull/42', title: 'Existing PR' };
    platform.findOpenPR.mockResolvedValue(existingPR);

    const fleet = new FleetOrchestrator(
      config,
      issues,
      worktreeManager as any,
      launcher as any,
      platform as any,
      logger as any,
      notifications,
    );

    await fleet.run();

    expect(worktreeManager.provision).not.toHaveBeenCalled();
  });

  it('returns IssueResult with success: true and pr populated when existing PR is found', async () => {
    const config = makeConfig();
    const issues = [makeIssue(1)];
    const { worktreeManager, launcher, platform, logger } = makeMockDeps();
    const notifications = { dispatch: vi.fn().mockResolvedValue(undefined) } as any;

    const existingPR = { number: 42, url: 'https://github.com/owner/repo/pull/42', title: 'Existing PR' };
    platform.findOpenPR.mockResolvedValue(existingPR);

    const fleet = new FleetOrchestrator(
      config,
      issues,
      worktreeManager as any,
      launcher as any,
      platform as any,
      logger as any,
      notifications,
    );

    const result = await fleet.run();

    expect(result.issues).toHaveLength(1);
    const skippedResult = result.issues[0];
    expect(skippedResult.success).toBe(true);
    expect(skippedResult.pr).toEqual(existingPR);
    expect(skippedResult.phases).toEqual([]);
    expect(skippedResult.issueNumber).toBe(1);
  });

  it('logs an info message containing the PR URL when skipping', async () => {
    const config = makeConfig();
    const issues = [makeIssue(1)];
    const { worktreeManager, launcher, platform, logger } = makeMockDeps();
    const notifications = { dispatch: vi.fn().mockResolvedValue(undefined) } as any;

    const existingPR = { number: 42, url: 'https://github.com/owner/repo/pull/42', title: 'Existing PR' };
    platform.findOpenPR.mockResolvedValue(existingPR);

    const fleet = new FleetOrchestrator(
      config,
      issues,
      worktreeManager as any,
      launcher as any,
      platform as any,
      logger as any,
      notifications,
    );

    await fleet.run();

    const infoCall = (logger.info as ReturnType<typeof vi.fn>).mock.calls.find(
      ([msg]: [string]) => typeof msg === 'string' && msg.includes(existingPR.url),
    );
    expect(infoCall).toBeDefined();
  });

  it('records the issue as completed in the fleet checkpoint when skipping', async () => {
    const { FleetCheckpointManager } = await import('../src/core/checkpoint.js');
    const setIssueStatusMock = vi.fn().mockResolvedValue(undefined);
    (FleetCheckpointManager as ReturnType<typeof vi.fn>).mockImplementationOnce(() => ({
      load: vi.fn().mockResolvedValue(undefined),
      isIssueCompleted: vi.fn().mockReturnValue(false),
      setIssueStatus: setIssueStatusMock,
      recordTokenUsage: vi.fn().mockResolvedValue(undefined),
      getIssueStatus: vi.fn().mockReturnValue(null),
    }));

    const config = makeConfig();
    const issues = [makeIssue(1)];
    const { worktreeManager, launcher, platform, logger } = makeMockDeps();
    const notifications = { dispatch: vi.fn().mockResolvedValue(undefined) } as any;

    const existingPR = { number: 42, url: 'https://github.com/owner/repo/pull/42', title: 'Existing PR' };
    platform.findOpenPR.mockResolvedValue(existingPR);

    const fleet = new FleetOrchestrator(
      config,
      issues,
      worktreeManager as any,
      launcher as any,
      platform as any,
      logger as any,
      notifications,
    );

    await fleet.run();

    const completedCall = setIssueStatusMock.mock.calls.find(
      (args: unknown[]) => args[0] === 1 && args[1] === 'completed',
    );
    expect(completedCall).toBeDefined();
  });

  it('proceeds normally (provisions worktree) when findOpenPR() throws an error', async () => {
    const config = makeConfig();
    const issues = [makeIssue(1)];
    const { worktreeManager, launcher, platform, logger } = makeMockDeps();
    const notifications = { dispatch: vi.fn().mockResolvedValue(undefined) } as any;

    platform.findOpenPR.mockRejectedValue(new Error('API timeout'));

    const fleet = new FleetOrchestrator(
      config,
      issues,
      worktreeManager as any,
      launcher as any,
      platform as any,
      logger as any,
      notifications,
    );

    await fleet.run();

    expect(worktreeManager.provision).toHaveBeenCalledTimes(1);
  });

  it('logs a warning when findOpenPR() throws and issue continues', async () => {
    const config = makeConfig();
    const issues = [makeIssue(1)];
    const { worktreeManager, launcher, platform, logger } = makeMockDeps();
    const notifications = { dispatch: vi.fn().mockResolvedValue(undefined) } as any;

    platform.findOpenPR.mockRejectedValue(new Error('API timeout'));

    const fleet = new FleetOrchestrator(
      config,
      issues,
      worktreeManager as any,
      launcher as any,
      platform as any,
      logger as any,
      notifications,
    );

    await fleet.run();

    expect(logger.warn).toHaveBeenCalled();
  });

  it('does not skip provisioning when findOpenPR() returns null (no existing PR)', async () => {
    const config = makeConfig();
    const issues = [makeIssue(1)];
    const { worktreeManager, launcher, platform, logger } = makeMockDeps();
    const notifications = { dispatch: vi.fn().mockResolvedValue(undefined) } as any;

    platform.findOpenPR.mockResolvedValue(null);

    const fleet = new FleetOrchestrator(
      config,
      issues,
      worktreeManager as any,
      launcher as any,
      platform as any,
      logger as any,
      notifications,
    );

    await fleet.run();

    expect(worktreeManager.provision).toHaveBeenCalledTimes(1);
  });

  it('issue with codeComplete=true and prCreated=false appears in codeDoneNoPR and not in prsCreated or failedIssues', async () => {
    const { IssueOrchestrator } = await import('../src/core/issue-orchestrator.js');
    (IssueOrchestrator as ReturnType<typeof vi.fn>).mockImplementationOnce(() => ({
      run: vi.fn().mockResolvedValue({
        issueNumber: 7,
        issueTitle: 'Issue 7',
        success: true,
        codeComplete: true,
        prCreated: false,
        phases: [],
        totalDuration: 100,
        tokenUsage: 100,
      }),
    }));

    const config = makeConfig();
    const issues = [makeIssue(7)];
    const { worktreeManager, launcher, platform, logger } = makeMockDeps();
    const notifications = { dispatch: vi.fn().mockResolvedValue(undefined) } as any;

    const fleet = new FleetOrchestrator(
      config,
      issues,
      worktreeManager as any,
      launcher as any,
      platform as any,
      logger as any,
      notifications,
    );

    const result = await fleet.run();

    expect(result.codeDoneNoPR).toHaveLength(1);
    expect(result.codeDoneNoPR[0]).toMatchObject({ issueNumber: 7, issueTitle: 'Issue 7' });
    expect(result.prsCreated).toHaveLength(0);
    expect(result.failedIssues).toHaveLength(0);
  });

  it('skips all issues individually when each has an existing open PR', async () => {
    const config = makeConfig({ maxParallelIssues: 3 });
    const issues = [makeIssue(1), makeIssue(2), makeIssue(3)];
    const { worktreeManager, launcher, platform, logger } = makeMockDeps();
    const notifications = { dispatch: vi.fn().mockResolvedValue(undefined) } as any;

    platform.findOpenPR.mockImplementation(async (issueNumber: number) => ({
      number: 100 + issueNumber,
      url: `https://github.com/owner/repo/pull/${100 + issueNumber}`,
      title: `PR for issue ${issueNumber}`,
    }));

    const fleet = new FleetOrchestrator(
      config,
      issues,
      worktreeManager as any,
      launcher as any,
      platform as any,
      logger as any,
      notifications,
    );

    const result = await fleet.run();

    expect(worktreeManager.provision).not.toHaveBeenCalled();
    expect(result.issues).toHaveLength(3);
    expect(result.issues.every((i) => i.success === true)).toBe(true);
    expect(result.failedIssues).toHaveLength(0);
  });
});

describe('FleetOrchestrator — codeDoneNoPR', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('prsCreated only includes issues where ir.pr != null, not just prCreated flag', async () => {
    const { IssueOrchestrator } = await import('../src/core/issue-orchestrator.js');
    // Issue has prCreated: true but no pr object — should NOT be in prsCreated
    (IssueOrchestrator as ReturnType<typeof vi.fn>).mockImplementationOnce(() => ({
      run: vi.fn().mockResolvedValue({
        issueNumber: 1,
        issueTitle: 'Issue 1',
        success: true,
        codeComplete: true,
        prCreated: true,
        pr: undefined, // no pr object
        phases: [],
        totalDuration: 100,
        tokenUsage: 100,
      }),
    }));

    const config = makeConfig();
    const issues = [makeIssue(1)];
    const { worktreeManager, launcher, platform, logger } = makeMockDeps();
    const notifications = { dispatch: vi.fn().mockResolvedValue(undefined) } as any;

    const fleet = new FleetOrchestrator(
      config,
      issues,
      worktreeManager as any,
      launcher as any,
      platform as any,
      logger as any,
      notifications,
    );

    const result = await fleet.run();

    expect(result.prsCreated).toHaveLength(0);
  });

  it('prsCreated includes the pr object when ir.pr is non-null', async () => {
    const { IssueOrchestrator } = await import('../src/core/issue-orchestrator.js');
    const mockPR = { number: 99, url: 'https://github.com/owner/repo/pull/99', title: 'Fix issue' };
    (IssueOrchestrator as ReturnType<typeof vi.fn>).mockImplementationOnce(() => ({
      run: vi.fn().mockResolvedValue({
        issueNumber: 1,
        issueTitle: 'Issue 1',
        success: true,
        codeComplete: true,
        prCreated: true,
        pr: mockPR,
        phases: [],
        totalDuration: 100,
        tokenUsage: 100,
      }),
    }));

    const config = makeConfig();
    const issues = [makeIssue(1)];
    const { worktreeManager, launcher, platform, logger } = makeMockDeps();
    const notifications = { dispatch: vi.fn().mockResolvedValue(undefined) } as any;

    const fleet = new FleetOrchestrator(
      config,
      issues,
      worktreeManager as any,
      launcher as any,
      platform as any,
      logger as any,
      notifications,
    );

    const result = await fleet.run();

    expect(result.prsCreated).toHaveLength(1);
    expect(result.prsCreated[0]).toEqual(mockPR);
    expect(result.codeDoneNoPR).toHaveLength(0);
  });

  it('sets fleet checkpoint status to code-complete-no-pr when codeComplete=true and prCreated=false', async () => {
    const { IssueOrchestrator } = await import('../src/core/issue-orchestrator.js');
    (IssueOrchestrator as ReturnType<typeof vi.fn>).mockImplementationOnce(() => ({
      run: vi.fn().mockResolvedValue({
        issueNumber: 1,
        issueTitle: 'Issue 1',
        success: true,
        codeComplete: true,
        prCreated: false,
        phases: [],
        totalDuration: 100,
        tokenUsage: 100,
      }),
    }));

    const { FleetCheckpointManager } = await import('../src/core/checkpoint.js');
    const setIssueStatusMock = vi.fn().mockResolvedValue(undefined);
    (FleetCheckpointManager as ReturnType<typeof vi.fn>).mockImplementationOnce(() => ({
      load: vi.fn().mockResolvedValue(undefined),
      isIssueCompleted: vi.fn().mockReturnValue(false),
      setIssueStatus: setIssueStatusMock,
      recordTokenUsage: vi.fn().mockResolvedValue(undefined),
      getIssueStatus: vi.fn().mockReturnValue(null),
    }));

    const config = makeConfig();
    const issues = [makeIssue(1)];
    const { worktreeManager, launcher, platform, logger } = makeMockDeps();
    const notifications = { dispatch: vi.fn().mockResolvedValue(undefined) } as any;

    const fleet = new FleetOrchestrator(
      config,
      issues,
      worktreeManager as any,
      launcher as any,
      platform as any,
      logger as any,
      notifications,
    );

    await fleet.run();

    const codeCompleteNoPRCall = setIssueStatusMock.mock.calls.find(
      (args: unknown[]) => args[1] === 'code-complete-no-pr',
    );
    expect(codeCompleteNoPRCall).toBeDefined();
    expect(codeCompleteNoPRCall![0]).toBe(1);
  });

  it('does NOT set code-complete-no-pr status when prCreated=true', async () => {
    const { IssueOrchestrator } = await import('../src/core/issue-orchestrator.js');
    const mockPR = { number: 42, url: 'https://github.com/owner/repo/pull/42', title: 'Fix' };
    (IssueOrchestrator as ReturnType<typeof vi.fn>).mockImplementationOnce(() => ({
      run: vi.fn().mockResolvedValue({
        issueNumber: 1,
        issueTitle: 'Issue 1',
        success: true,
        codeComplete: true,
        prCreated: true,
        pr: mockPR,
        phases: [],
        totalDuration: 100,
        tokenUsage: 100,
      }),
    }));

    const { FleetCheckpointManager } = await import('../src/core/checkpoint.js');
    const setIssueStatusMock = vi.fn().mockResolvedValue(undefined);
    (FleetCheckpointManager as ReturnType<typeof vi.fn>).mockImplementationOnce(() => ({
      load: vi.fn().mockResolvedValue(undefined),
      isIssueCompleted: vi.fn().mockReturnValue(false),
      setIssueStatus: setIssueStatusMock,
      recordTokenUsage: vi.fn().mockResolvedValue(undefined),
      getIssueStatus: vi.fn().mockReturnValue(null),
    }));

    const config = makeConfig();
    const issues = [makeIssue(1)];
    const { worktreeManager, launcher, platform, logger } = makeMockDeps();
    const notifications = { dispatch: vi.fn().mockResolvedValue(undefined) } as any;

    const fleet = new FleetOrchestrator(
      config,
      issues,
      worktreeManager as any,
      launcher as any,
      platform as any,
      logger as any,
      notifications,
    );

    await fleet.run();

    const codeCompleteNoPRCall = setIssueStatusMock.mock.calls.find(
      (args: unknown[]) => args[1] === 'code-complete-no-pr',
    );
    expect(codeCompleteNoPRCall).toBeUndefined();
  });

  it('fleet progress event log includes codeDoneNoPR.length count', async () => {
    const { IssueOrchestrator } = await import('../src/core/issue-orchestrator.js');
    (IssueOrchestrator as ReturnType<typeof vi.fn>).mockImplementationOnce(() => ({
      run: vi.fn().mockResolvedValue({
        issueNumber: 1,
        issueTitle: 'Issue 1',
        success: true,
        codeComplete: true,
        prCreated: false,
        phases: [],
        totalDuration: 100,
        tokenUsage: 100,
      }),
    }));

    const { FleetProgressWriter } = await import('../src/core/progress.js');
    const appendEventMock = vi.fn().mockResolvedValue(undefined);
    (FleetProgressWriter as ReturnType<typeof vi.fn>).mockImplementationOnce(() => ({
      write: vi.fn().mockResolvedValue(undefined),
      appendEvent: appendEventMock,
    }));

    const config = makeConfig();
    const issues = [makeIssue(1)];
    const { worktreeManager, launcher, platform, logger } = makeMockDeps();
    const notifications = { dispatch: vi.fn().mockResolvedValue(undefined) } as any;

    const fleet = new FleetOrchestrator(
      config,
      issues,
      worktreeManager as any,
      launcher as any,
      platform as any,
      logger as any,
      notifications,
    );

    await fleet.run();

    const completedEvent = appendEventMock.mock.calls.find(
      ([msg]: [string]) => typeof msg === 'string' && msg.includes('Fleet completed'),
    );
    expect(completedEvent).toBeDefined();
    // The event should mention the code-done-no-pr count (1 in this case)
    expect(completedEvent![0]).toContain('code-done-no-pr');
    expect(completedEvent![0]).toContain('1');
  });

  it('codeDoneNoPR is empty when all issues have pr objects (codeComplete=true, pr set)', async () => {
    const { IssueOrchestrator } = await import('../src/core/issue-orchestrator.js');
    const mockPR = { number: 10, url: 'https://github.com/owner/repo/pull/10', title: 'Fix' };
    (IssueOrchestrator as ReturnType<typeof vi.fn>).mockImplementationOnce(() => ({
      run: vi.fn().mockResolvedValue({
        issueNumber: 1,
        issueTitle: 'Issue 1',
        success: true,
        codeComplete: true,
        prCreated: true,
        pr: mockPR,
        phases: [],
        totalDuration: 100,
        tokenUsage: 100,
      }),
    }));

    const config = makeConfig();
    const issues = [makeIssue(1)];
    const { worktreeManager, launcher, platform, logger } = makeMockDeps();
    const notifications = { dispatch: vi.fn().mockResolvedValue(undefined) } as any;

    const fleet = new FleetOrchestrator(
      config,
      issues,
      worktreeManager as any,
      launcher as any,
      platform as any,
      logger as any,
      notifications,
    );

    const result = await fleet.run();

    expect(result.codeDoneNoPR).toHaveLength(0);
    expect(result.prsCreated).toHaveLength(1);
  });

  it('runReviewResponse returns codeDoneNoPR as empty array', async () => {
    const config = makeConfig();
    const issues = [makeIssue(1)];
    const { worktreeManager, launcher, platform, logger } = makeMockDeps();
    const notifications = { dispatch: vi.fn().mockResolvedValue(undefined) } as any;

    const fleet = new FleetOrchestrator(
      config,
      issues,
      worktreeManager as any,
      launcher as any,
      platform as any,
      logger as any,
      notifications,
    );

    const result = await fleet.runReviewResponse();

    expect(result.codeDoneNoPR).toEqual([]);
  });

  it('runReviewResponse computes codeDoneNoPR from issueResults where codeComplete=true and prCreated!=true', async () => {
    const { ReviewResponseOrchestrator } = await import('../src/core/review-response-orchestrator.js');
    (ReviewResponseOrchestrator as ReturnType<typeof vi.fn>).mockImplementationOnce(() => ({
      run: vi.fn().mockResolvedValue({
        processed: 2,
        skipped: 0,
        succeeded: 2,
        failed: 0,
        issues: [
          {
            issueNumber: 10,
            skipped: false,
            result: {
              issueNumber: 10,
              issueTitle: 'Issue 10',
              success: true,
              codeComplete: true,
              prCreated: false,
              phases: [],
              totalDuration: 100,
              tokenUsage: 200,
            },
          },
          {
            issueNumber: 11,
            skipped: false,
            result: {
              issueNumber: 11,
              issueTitle: 'Issue 11',
              success: true,
              codeComplete: true,
              prCreated: true,
              pr: { number: 55, url: 'https://github.com/owner/repo/pull/55', title: 'Fix 11' },
              phases: [],
              totalDuration: 100,
              tokenUsage: 200,
            },
          },
        ],
      }),
    }));

    const config = makeConfig();
    const issues = [makeIssue(10), makeIssue(11)];
    const { worktreeManager, launcher, platform, logger } = makeMockDeps();
    const notifications = { dispatch: vi.fn().mockResolvedValue(undefined) } as any;

    const fleet = new FleetOrchestrator(
      config,
      issues,
      worktreeManager as any,
      launcher as any,
      platform as any,
      logger as any,
      notifications,
    );

    const result = await fleet.runReviewResponse();

    expect(result.codeDoneNoPR).toHaveLength(1);
    expect(result.codeDoneNoPR[0]).toMatchObject({ issueNumber: 10, issueTitle: 'Issue 10' });
  });

  it('runReviewResponse excludes issues with prCreated=true from codeDoneNoPR', async () => {
    const { ReviewResponseOrchestrator } = await import('../src/core/review-response-orchestrator.js');
    (ReviewResponseOrchestrator as ReturnType<typeof vi.fn>).mockImplementationOnce(() => ({
      run: vi.fn().mockResolvedValue({
        processed: 1,
        skipped: 0,
        succeeded: 1,
        failed: 0,
        issues: [
          {
            issueNumber: 20,
            skipped: false,
            result: {
              issueNumber: 20,
              issueTitle: 'Issue 20',
              success: true,
              codeComplete: true,
              prCreated: true,
              pr: { number: 77, url: 'https://github.com/owner/repo/pull/77', title: 'Fix 20' },
              phases: [],
              totalDuration: 100,
              tokenUsage: 300,
            },
          },
        ],
      }),
    }));

    const config = makeConfig();
    const issues = [makeIssue(20)];
    const { worktreeManager, launcher, platform, logger } = makeMockDeps();
    const notifications = { dispatch: vi.fn().mockResolvedValue(undefined) } as any;

    const fleet = new FleetOrchestrator(
      config,
      issues,
      worktreeManager as any,
      launcher as any,
      platform as any,
      logger as any,
      notifications,
    );

    const result = await fleet.runReviewResponse();

    expect(result.codeDoneNoPR).toHaveLength(0);
    expect(result.prsCreated).toHaveLength(1);
  });

  it('runReviewResponse excludes issues with codeComplete=false from codeDoneNoPR', async () => {
    const { ReviewResponseOrchestrator } = await import('../src/core/review-response-orchestrator.js');
    (ReviewResponseOrchestrator as ReturnType<typeof vi.fn>).mockImplementationOnce(() => ({
      run: vi.fn().mockResolvedValue({
        processed: 1,
        skipped: 0,
        succeeded: 1,
        failed: 0,
        issues: [
          {
            issueNumber: 30,
            skipped: false,
            result: {
              issueNumber: 30,
              issueTitle: 'Issue 30',
              success: true,
              codeComplete: false,
              prCreated: false,
              phases: [],
              totalDuration: 100,
              tokenUsage: 100,
            },
          },
        ],
      }),
    }));

    const config = makeConfig();
    const issues = [makeIssue(30)];
    const { worktreeManager, launcher, platform, logger } = makeMockDeps();
    const notifications = { dispatch: vi.fn().mockResolvedValue(undefined) } as any;

    const fleet = new FleetOrchestrator(
      config,
      issues,
      worktreeManager as any,
      launcher as any,
      platform as any,
      logger as any,
      notifications,
    );

    const result = await fleet.runReviewResponse();

    expect(result.codeDoneNoPR).toHaveLength(0);
  });
});
