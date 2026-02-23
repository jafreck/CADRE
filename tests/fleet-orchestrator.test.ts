import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FleetOrchestrator } from '../src/core/fleet-orchestrator.js';
import { NotificationManager } from '../src/notifications/manager.js';
import { RemoteBranchMissingError } from '../src/git/worktree.js';
import type { CadreConfig } from '../src/config/schema.js';
import type { IssueDetail } from '../src/platform/provider.js';

// Mock heavy dependencies to keep tests fast and isolated
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
  IssueOrchestrator: vi.fn().mockImplementation((_config: unknown, issue: { number: number; title: string }) => ({
    run: vi.fn().mockResolvedValue({
      issueNumber: issue.number,
      issueTitle: issue.title,
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

function makeConfig(overrides: Partial<CadreConfig['options']> = {}): CadreConfig {
  return {
    projectName: 'test-project',
    platform: 'github',
    repository: 'owner/repo',
    repoPath: '/tmp/repo',
    baseBranch: 'main',
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
      ...overrides,
    },
    commands: {},
    copilot: { cliCommand: 'copilot', model: 'claude-sonnet-4', agentDir: '.github/agents', timeout: 300000, costOverrides: {} },
    notifications: { enabled: false, providers: [] },
  } as unknown as CadreConfig;
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
  };
  const launcher = {};
  const platform = {};
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

    // Issue 1 failed due to RemoteBranchMissingError; issue 2 was still processed
    expect(result.failedIssues).toHaveLength(1);
    expect(result.failedIssues[0].issueNumber).toBe(1);
    // Both issues should appear in result.issues
    expect(result.issues).toHaveLength(2);
    // At least one issue succeeded (issue 2 went through IssueOrchestrator successfully)
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
    // Should NOT log an error for this specific case
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

    // Default mock resolves successfully
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
