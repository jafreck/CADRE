import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FleetOrchestrator } from '../src/core/fleet-orchestrator.js';
import { NotificationManager } from '../src/notifications/manager.js';
import type { CadreConfig } from '../src/config/schema.js';
import type { IssueDetail } from '../src/platform/provider.js';

// Mock heavy dependencies to keep tests fast and isolated
vi.mock('../src/git/worktree.js', () => ({
  WorktreeManager: vi.fn(),
}));
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

describe('FleetOrchestrator — postCostComment and token recording (task-010)', () => {
  let recordTokenUsageSpy: ReturnType<typeof vi.fn>;
  let fleetCheckpointMock: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.clearAllMocks();
    recordTokenUsageSpy = vi.fn().mockResolvedValue(undefined);
    const checkpointMod = await import('../src/core/checkpoint.js');
    fleetCheckpointMock = checkpointMod.FleetCheckpointManager as ReturnType<typeof vi.fn>;
    fleetCheckpointMock.mockImplementation(() => ({
      load: vi.fn().mockResolvedValue(undefined),
      isIssueCompleted: vi.fn().mockReturnValue(false),
      setIssueStatus: vi.fn().mockResolvedValue(undefined),
      recordTokenUsage: recordTokenUsageSpy,
      getIssueStatus: vi.fn().mockReturnValue(null),
    }));
  });

  it('passes config (with postCostComment) to IssueOrchestrator', async () => {
    const { IssueOrchestrator } = await import('../src/core/issue-orchestrator.js');
    const IssueOrchestratorMock = IssueOrchestrator as ReturnType<typeof vi.fn>;
    IssueOrchestratorMock.mockImplementation(() => ({
      run: vi.fn().mockResolvedValue({
        issueNumber: 1,
        issueTitle: 'Test issue',
        success: true,
        phases: [],
        totalDuration: 100,
        tokenUsage: 500,
      }),
    }));

    const config = makeConfig({ postCostComment: true } as any);
    const issues = [makeIssue(1)];
    const { worktreeManager, launcher, platform, logger } = makeMockDeps();

    const fleet = new FleetOrchestrator(
      config,
      issues,
      worktreeManager as any,
      launcher as any,
      platform as any,
      logger as any,
    );

    await fleet.run();

    expect(IssueOrchestratorMock).toHaveBeenCalledWith(
      expect.objectContaining({ options: expect.objectContaining({ postCostComment: true }) }),
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.anything(),
      expect.anything(),
    );
  });

  it('calls FleetCheckpointManager.recordTokenUsage() with issue number and token count after issue completes', async () => {
    const { IssueOrchestrator } = await import('../src/core/issue-orchestrator.js');
    (IssueOrchestrator as ReturnType<typeof vi.fn>).mockImplementation(() => ({
      run: vi.fn().mockResolvedValue({
        issueNumber: 42,
        issueTitle: 'Test issue',
        success: true,
        phases: [],
        totalDuration: 100,
        tokenUsage: 1234,
      }),
    }));

    const config = makeConfig();
    const issues = [makeIssue(42)];
    const { worktreeManager, launcher, platform, logger } = makeMockDeps();
    worktreeManager.provision = vi.fn().mockResolvedValue({
      path: '/tmp/worktree/42',
      branch: 'cadre/issue-42',
      baseCommit: 'abc123',
    });

    const fleet = new FleetOrchestrator(
      config,
      issues,
      worktreeManager as any,
      launcher as any,
      platform as any,
      logger as any,
    );

    await fleet.run();

    expect(recordTokenUsageSpy).toHaveBeenCalledWith(42, 1234);
  });

  it('does not call recordTokenUsage when tokenUsage is null', async () => {
    const { IssueOrchestrator } = await import('../src/core/issue-orchestrator.js');
    (IssueOrchestrator as ReturnType<typeof vi.fn>).mockImplementation(() => ({
      run: vi.fn().mockResolvedValue({
        issueNumber: 1,
        issueTitle: 'Test issue',
        success: true,
        phases: [],
        totalDuration: 100,
        tokenUsage: null,
      }),
    }));

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
    );

    await fleet.run();

    expect(recordTokenUsageSpy).not.toHaveBeenCalled();
  });

  it('calls recordTokenUsage once per issue when multiple issues complete', async () => {
    const { IssueOrchestrator } = await import('../src/core/issue-orchestrator.js');
    (IssueOrchestrator as ReturnType<typeof vi.fn>).mockImplementation(() => ({
      run: vi.fn().mockResolvedValue({
        issueNumber: 0,
        issueTitle: 'Test issue',
        success: true,
        phases: [],
        totalDuration: 100,
        tokenUsage: 100,
      }),
    }));

    const config = makeConfig({ maxParallelIssues: 5 });
    const issues = [makeIssue(1), makeIssue(2), makeIssue(3)];
    const { worktreeManager, launcher, platform, logger } = makeMockDeps();

    const fleet = new FleetOrchestrator(
      config,
      issues,
      worktreeManager as any,
      launcher as any,
      platform as any,
      logger as any,
    );

    await fleet.run();

    expect(recordTokenUsageSpy).toHaveBeenCalledTimes(3);
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
        tokenUsage: 99999, // very large to exceed budget
      }),
    }));

    const config = makeConfig({ tokenBudget: 1 }); // tiny budget to force exceeded
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
      budget: 1,
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
        tokenUsage: 9000, // 90% of 10000
      }),
    }));

    const config = makeConfig({ tokenBudget: 10000 });
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
      budget: 10000,
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
