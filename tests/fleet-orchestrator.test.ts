import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FleetOrchestrator } from '../src/core/fleet-orchestrator.js';
import { NotificationManager } from '../src/notifications/manager.js';
import { FleetCheckpointManager } from '../src/core/checkpoint.js';
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

  it('run() returns a FleetResult with correct shape including codeDoneNoPR', async () => {
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

describe('FleetOrchestrator — codeDoneNoPR', () => {
  let dispatchSpy: ReturnType<typeof vi.fn>;
  let notifications: NotificationManager;

  beforeEach(() => {
    vi.clearAllMocks();
    dispatchSpy = vi.fn().mockResolvedValue(undefined);
    notifications = { dispatch: dispatchSpy } as unknown as NotificationManager;
  });

  it('places a codeComplete+!prCreated issue in codeDoneNoPR, not prsCreated or failedIssues', async () => {
    const { IssueOrchestrator } = await import('../src/core/issue-orchestrator.js');
    (IssueOrchestrator as ReturnType<typeof vi.fn>).mockImplementationOnce(() => ({
      run: vi.fn().mockResolvedValue({
        issueNumber: 1,
        issueTitle: 'Issue 1',
        success: true,
        codeComplete: true,
        prCreated: false,
        pr: undefined,
        phases: [],
        totalDuration: 100,
        tokenUsage: 500,
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
      notifications,
    );

    const result = await fleet.run();

    expect(result.codeDoneNoPR).toHaveLength(1);
    expect(result.codeDoneNoPR[0]).toEqual({ issueNumber: 1, issueTitle: 'Issue 1' });
    expect(result.prsCreated).toHaveLength(0);
    expect(result.failedIssues).toHaveLength(0);
  });

  it('success is true when only codeDoneNoPR issues exist (no failures)', async () => {
    const { IssueOrchestrator } = await import('../src/core/issue-orchestrator.js');
    (IssueOrchestrator as ReturnType<typeof vi.fn>).mockImplementationOnce(() => ({
      run: vi.fn().mockResolvedValue({
        issueNumber: 1,
        issueTitle: 'Issue 1',
        success: true,
        codeComplete: true,
        prCreated: false,
        pr: undefined,
        phases: [],
        totalDuration: 100,
        tokenUsage: 500,
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
      notifications,
    );

    const result = await fleet.run();

    expect(result.success).toBe(true);
  });

  it('success is false when there are failed issues, regardless of codeDoneNoPR', async () => {
    const { IssueOrchestrator } = await import('../src/core/issue-orchestrator.js');
    // First issue: codeComplete, no PR
    (IssueOrchestrator as ReturnType<typeof vi.fn>)
      .mockImplementationOnce(() => ({
        run: vi.fn().mockResolvedValue({
          issueNumber: 1,
          issueTitle: 'Issue 1',
          success: true,
          codeComplete: true,
          prCreated: false,
          pr: undefined,
          phases: [],
          totalDuration: 100,
          tokenUsage: 0,
        }),
      }))
      // Second issue: failed
      .mockImplementationOnce(() => ({
        run: vi.fn().mockResolvedValue({
          issueNumber: 2,
          issueTitle: 'Issue 2',
          success: false,
          codeComplete: false,
          prCreated: false,
          pr: undefined,
          phases: [],
          totalDuration: 100,
          tokenUsage: 0,
          error: 'Pipeline failed',
        }),
      }));

    const config = makeConfig();
    const issues = [makeIssue(1), makeIssue(2)];
    const { worktreeManager, launcher, platform, logger } = makeMockDeps();

    (worktreeManager.provision as ReturnType<typeof vi.fn>).mockImplementation((num: number) =>
      Promise.resolve({
        path: `/tmp/worktree/${num}`,
        branch: `cadre/issue-${num}`,
        baseCommit: 'abc123',
      }),
    );

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

    expect(result.success).toBe(false);
    expect(result.codeDoneNoPR).toHaveLength(1);
    expect(result.failedIssues).toHaveLength(1);
  });

  it('sets fleet checkpoint status to code-complete-no-pr for codeComplete+!prCreated issues', async () => {
    const { IssueOrchestrator } = await import('../src/core/issue-orchestrator.js');
    (IssueOrchestrator as ReturnType<typeof vi.fn>).mockImplementationOnce(() => ({
      run: vi.fn().mockResolvedValue({
        issueNumber: 1,
        issueTitle: 'Issue 1',
        success: true,
        codeComplete: true,
        prCreated: false,
        pr: undefined,
        phases: [1],
        totalDuration: 100,
        tokenUsage: 500,
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
      notifications,
    );

    await fleet.run();

    // The FleetCheckpointManager instance is created in the FleetOrchestrator constructor.
    // mock.results[0] holds the instance created in this test (after vi.clearAllMocks()).
    const checkpointInstance = (FleetCheckpointManager as unknown as ReturnType<typeof vi.fn>).mock.results[0].value;
    const statusCalls = checkpointInstance.setIssueStatus.mock.calls as unknown[][];
    // Find the call that sets a terminal status (not 'in-progress')
    const terminalCall = statusCalls.find((args) => args[1] !== 'in-progress');
    expect(terminalCall).toBeDefined();
    expect(terminalCall![1]).toBe('code-complete-no-pr');
  });

  it('codeDoneNoPR issue is independent of prCreated issues in the same run', async () => {
    const { IssueOrchestrator } = await import('../src/core/issue-orchestrator.js');
    const fakePr = { number: 99, url: 'https://github.com/owner/repo/pull/99', title: 'PR 99' };
    // Issue 1: PR created
    (IssueOrchestrator as ReturnType<typeof vi.fn>)
      .mockImplementationOnce(() => ({
        run: vi.fn().mockResolvedValue({
          issueNumber: 1,
          issueTitle: 'Issue 1',
          success: true,
          codeComplete: true,
          prCreated: true,
          pr: fakePr,
          phases: [],
          totalDuration: 100,
          tokenUsage: 0,
        }),
      }))
      // Issue 2: code complete, no PR
      .mockImplementationOnce(() => ({
        run: vi.fn().mockResolvedValue({
          issueNumber: 2,
          issueTitle: 'Issue 2',
          success: true,
          codeComplete: true,
          prCreated: false,
          pr: undefined,
          phases: [],
          totalDuration: 100,
          tokenUsage: 0,
        }),
      }));

    const config = makeConfig();
    const issues = [makeIssue(1), makeIssue(2)];
    const { worktreeManager, launcher, platform, logger } = makeMockDeps();

    (worktreeManager.provision as ReturnType<typeof vi.fn>).mockImplementation((num: number) =>
      Promise.resolve({
        path: `/tmp/worktree/${num}`,
        branch: `cadre/issue-${num}`,
        baseCommit: 'abc123',
      }),
    );

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
    expect(result.prsCreated[0]).toMatchObject({ number: 99 });
    expect(result.codeDoneNoPR).toHaveLength(1);
    expect(result.codeDoneNoPR[0]).toEqual({ issueNumber: 2, issueTitle: 'Issue 2' });
    expect(result.failedIssues).toHaveLength(0);
    expect(result.success).toBe(true);
  });
});

describe('FleetOrchestrator — codeDoneNoPR aggregation', () => {
  let notifications: NotificationManager;

  beforeEach(() => {
    vi.clearAllMocks();
    notifications = { dispatch: vi.fn().mockResolvedValue(undefined) } as unknown as NotificationManager;
  });

  it('places codeComplete=true, prCreated=false issues into codeDoneNoPR', async () => {
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

    const config = makeConfig();
    const issues = [makeIssue(1)];
    const { worktreeManager, launcher, platform, logger } = makeMockDeps();

    const fleet = new FleetOrchestrator(
      config, issues, worktreeManager as any, launcher as any, platform as any, logger as any, notifications,
    );
    const result = await fleet.run();

    expect(result.codeDoneNoPR).toHaveLength(1);
    expect(result.codeDoneNoPR[0]).toEqual({ issueNumber: 1, issueTitle: 'Issue 1' });
    expect(result.prsCreated).toHaveLength(0);
  });

  it('does not add codeDoneNoPR issues to failedIssues', async () => {
    const { IssueOrchestrator } = await import('../src/core/issue-orchestrator.js');
    (IssueOrchestrator as ReturnType<typeof vi.fn>).mockImplementationOnce(() => ({
      run: vi.fn().mockResolvedValue({
        issueNumber: 2,
        issueTitle: 'Issue 2',
        success: true,
        codeComplete: true,
        prCreated: false,
        phases: [],
        totalDuration: 100,
        tokenUsage: 100,
      }),
    }));

    const config = makeConfig();
    const issues = [makeIssue(2)];
    const { worktreeManager, launcher, platform, logger } = makeMockDeps();

    const fleet = new FleetOrchestrator(
      config, issues, worktreeManager as any, launcher as any, platform as any, logger as any, notifications,
    );
    const result = await fleet.run();

    expect(result.failedIssues).toHaveLength(0);
  });

  it('success is true when all issues are codeDoneNoPR (no failures)', async () => {
    const { IssueOrchestrator } = await import('../src/core/issue-orchestrator.js');
    (IssueOrchestrator as ReturnType<typeof vi.fn>).mockImplementation(() => ({
      run: vi.fn().mockResolvedValue({
        issueNumber: 3,
        issueTitle: 'Issue 3',
        success: true,
        codeComplete: true,
        prCreated: false,
        phases: [],
        totalDuration: 100,
        tokenUsage: 100,
      }),
    }));

    const config = makeConfig();
    const issues = [makeIssue(3)];
    const { worktreeManager, launcher, platform, logger } = makeMockDeps();

    const fleet = new FleetOrchestrator(
      config, issues, worktreeManager as any, launcher as any, platform as any, logger as any, notifications,
    );
    const result = await fleet.run();

    expect(result.success).toBe(true);
    expect(result.codeDoneNoPR).toHaveLength(1);
    expect(result.failedIssues).toHaveLength(0);
  });

  it('uses code-complete-no-pr checkpoint status for codeComplete=true, prCreated=false issues', async () => {
    const { IssueOrchestrator } = await import('../src/core/issue-orchestrator.js');
    (IssueOrchestrator as ReturnType<typeof vi.fn>).mockImplementationOnce(() => ({
      run: vi.fn().mockResolvedValue({
        issueNumber: 4,
        issueTitle: 'Issue 4',
        success: true,
        codeComplete: true,
        prCreated: false,
        phases: [1],
        totalDuration: 100,
        tokenUsage: 100,
      }),
    }));

    const mockSetIssueStatus = vi.fn().mockResolvedValue(undefined);
    const { FleetCheckpointManager } = await import('../src/core/checkpoint.js');
    (FleetCheckpointManager as ReturnType<typeof vi.fn>).mockImplementationOnce(() => ({
      load: vi.fn().mockResolvedValue(undefined),
      isIssueCompleted: vi.fn().mockReturnValue(false),
      setIssueStatus: mockSetIssueStatus,
      recordTokenUsage: vi.fn().mockResolvedValue(undefined),
      getIssueStatus: vi.fn().mockReturnValue(null),
    }));

    const config = makeConfig();
    const issues = [makeIssue(4)];
    const { worktreeManager, launcher, platform, logger } = makeMockDeps();

    const fleet = new FleetOrchestrator(
      config, issues, worktreeManager as any, launcher as any, platform as any, logger as any, notifications,
    );
    await fleet.run();

    const setIssueStatusCalls = mockSetIssueStatus.mock.calls;
    const completionCall = setIssueStatusCalls.find(([, status]) => status !== 'in-progress');
    expect(completionCall).toBeDefined();
    expect(completionCall![1]).toBe('code-complete-no-pr');
  });

  it('does not put codeDoneNoPR issues into prsCreated', async () => {
    const { IssueOrchestrator } = await import('../src/core/issue-orchestrator.js');
    (IssueOrchestrator as ReturnType<typeof vi.fn>).mockImplementationOnce(() => ({
      run: vi.fn().mockResolvedValue({
        issueNumber: 5,
        issueTitle: 'Issue 5',
        success: true,
        codeComplete: true,
        prCreated: false,
        pr: undefined,
        phases: [],
        totalDuration: 100,
        tokenUsage: 100,
      }),
    }));

    const config = makeConfig();
    const issues = [makeIssue(5)];
    const { worktreeManager, launcher, platform, logger } = makeMockDeps();

    const fleet = new FleetOrchestrator(
      config, issues, worktreeManager as any, launcher as any, platform as any, logger as any, notifications,
    );
    const result = await fleet.run();

    expect(result.prsCreated).toHaveLength(0);
    expect(result.codeDoneNoPR).toHaveLength(1);
  });

  it('success remains false when failedIssues exist, even alongside codeDoneNoPR', async () => {
    const { IssueOrchestrator } = await import('../src/core/issue-orchestrator.js');
    let callCount = 0;
    (IssueOrchestrator as ReturnType<typeof vi.fn>).mockImplementation(() => ({
      run: vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return Promise.resolve({
            issueNumber: 10,
            issueTitle: 'Issue 10',
            success: true,
            codeComplete: true,
            prCreated: false,
            phases: [],
            totalDuration: 100,
            tokenUsage: 100,
          });
        }
        return Promise.resolve({
          issueNumber: 11,
          issueTitle: 'Issue 11',
          success: false,
          codeComplete: false,
          prCreated: false,
          phases: [],
          totalDuration: 100,
          tokenUsage: 100,
          error: 'Something went wrong',
        });
      }),
    }));

    const config = makeConfig();
    const issues = [makeIssue(10), makeIssue(11)];
    const { worktreeManager, launcher, platform, logger } = makeMockDeps();
    (worktreeManager.provision as ReturnType<typeof vi.fn>).mockImplementation((num: number) =>
      Promise.resolve({ path: `/tmp/worktree/${num}`, branch: `cadre/issue-${num}`, baseCommit: 'abc123' }),
    );

    const fleet = new FleetOrchestrator(
      config, issues, worktreeManager as any, launcher as any, platform as any, logger as any, notifications,
    );
    const result = await fleet.run();

    expect(result.success).toBe(false);
    expect(result.failedIssues).toHaveLength(1);
    expect(result.codeDoneNoPR).toHaveLength(1);
  });
});

describe('FleetOrchestrator — checkpoint status determination', () => {
  let notifications: NotificationManager;

  beforeEach(() => {
    vi.clearAllMocks();
    notifications = { dispatch: vi.fn().mockResolvedValue(undefined) } as unknown as NotificationManager;
  });

  async function runWithResult(
    issueResult: Record<string, unknown>,
    config = makeConfig(),
  ) {
    const { IssueOrchestrator } = await import('../src/core/issue-orchestrator.js');
    (IssueOrchestrator as ReturnType<typeof vi.fn>).mockImplementationOnce(() => ({
      run: vi.fn().mockResolvedValue(issueResult),
    }));

    const mockSetIssueStatus = vi.fn().mockResolvedValue(undefined);
    const { FleetCheckpointManager: FCM } = await import('../src/core/checkpoint.js');
    (FCM as ReturnType<typeof vi.fn>).mockImplementationOnce(() => ({
      load: vi.fn().mockResolvedValue(undefined),
      isIssueCompleted: vi.fn().mockReturnValue(false),
      setIssueStatus: mockSetIssueStatus,
      recordTokenUsage: vi.fn().mockResolvedValue(undefined),
      getIssueStatus: vi.fn().mockReturnValue(null),
    }));

    const issues = [makeIssue(1)];
    const { worktreeManager, launcher, platform, logger } = makeMockDeps();

    const fleet = new FleetOrchestrator(
      config, issues, worktreeManager as any, launcher as any, platform as any, logger as any, notifications,
    );
    await fleet.run();

    // Return only the terminal (non-in-progress) status call
    const calls = mockSetIssueStatus.mock.calls as unknown[][];
    return calls.find(([, status]) => status !== 'in-progress');
  }

  it('sets checkpoint status to completed when success=true and prCreated=true', async () => {
    const terminalCall = await runWithResult({
      issueNumber: 1,
      issueTitle: 'Issue 1',
      success: true,
      codeComplete: true,
      prCreated: true,
      phases: [1],
      totalDuration: 100,
      tokenUsage: 100,
    });
    expect(terminalCall).toBeDefined();
    expect(terminalCall![1]).toBe('completed');
  });

  it('sets checkpoint status to completed when success=true and codeComplete=false', async () => {
    const terminalCall = await runWithResult({
      issueNumber: 1,
      issueTitle: 'Issue 1',
      success: true,
      codeComplete: false,
      prCreated: false,
      phases: [1],
      totalDuration: 100,
      tokenUsage: 100,
    });
    expect(terminalCall).toBeDefined();
    expect(terminalCall![1]).toBe('completed');
  });

  it('sets checkpoint status to failed when success=false and budgetExceeded is falsy', async () => {
    const terminalCall = await runWithResult({
      issueNumber: 1,
      issueTitle: 'Issue 1',
      success: false,
      codeComplete: false,
      prCreated: false,
      phases: [],
      totalDuration: 100,
      tokenUsage: 100,
      error: 'Pipeline error',
    });
    expect(terminalCall).toBeDefined();
    expect(terminalCall![1]).toBe('failed');
  });

  it('sets checkpoint status to budget-exceeded when budgetExceeded=true, regardless of success', async () => {
    const terminalCall = await runWithResult({
      issueNumber: 1,
      issueTitle: 'Issue 1',
      success: false,
      codeComplete: false,
      prCreated: false,
      budgetExceeded: true,
      phases: [],
      totalDuration: 100,
      tokenUsage: 100,
    });
    expect(terminalCall).toBeDefined();
    expect(terminalCall![1]).toBe('budget-exceeded');
  });

  it('budget-exceeded takes precedence over code-complete-no-pr when both conditions are true', async () => {
    const terminalCall = await runWithResult({
      issueNumber: 1,
      issueTitle: 'Issue 1',
      success: false,
      codeComplete: true,
      prCreated: false,
      budgetExceeded: true,
      phases: [],
      totalDuration: 100,
      tokenUsage: 100,
    });
    expect(terminalCall).toBeDefined();
    expect(terminalCall![1]).toBe('budget-exceeded');
  });
});

describe('FleetOrchestrator — fleet completion event includes codeDoneNoPR count', () => {
  let notifications: NotificationManager;

  beforeEach(() => {
    vi.clearAllMocks();
    notifications = { dispatch: vi.fn().mockResolvedValue(undefined) } as unknown as NotificationManager;
  });

  it('fleet-completed event message includes code-done-no-pr count when there are codeDoneNoPR issues', async () => {
    const { IssueOrchestrator } = await import('../src/core/issue-orchestrator.js');
    (IssueOrchestrator as ReturnType<typeof vi.fn>).mockImplementationOnce(() => ({
      run: vi.fn().mockResolvedValue({
        issueNumber: 1,
        issueTitle: 'Issue 1',
        success: true,
        codeComplete: true,
        prCreated: false,
        pr: undefined,
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

    const fleet = new FleetOrchestrator(
      config, issues, worktreeManager as any, launcher as any, platform as any, logger as any, notifications,
    );
    await fleet.run();

    const completionCall = appendEventMock.mock.calls.find(([msg]: [string]) =>
      msg.includes('Fleet completed'),
    );
    expect(completionCall).toBeDefined();
    expect(completionCall![0]).toContain('code-done-no-pr');
    expect(completionCall![0]).toContain('1 code-done-no-pr');
  });

  it('fleet-completed event message includes 0 code-done-no-pr when no codeDoneNoPR issues', async () => {
    const { IssueOrchestrator } = await import('../src/core/issue-orchestrator.js');
    (IssueOrchestrator as ReturnType<typeof vi.fn>).mockImplementationOnce(() => ({
      run: vi.fn().mockResolvedValue({
        issueNumber: 1,
        issueTitle: 'Issue 1',
        success: true,
        codeComplete: true,
        prCreated: true,
        pr: { number: 10, url: 'https://github.com/owner/repo/pull/10', title: 'PR 10' },
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

    const fleet = new FleetOrchestrator(
      config, issues, worktreeManager as any, launcher as any, platform as any, logger as any, notifications,
    );
    await fleet.run();

    const completionCall = appendEventMock.mock.calls.find(([msg]: [string]) =>
      msg.includes('Fleet completed'),
    );
    expect(completionCall).toBeDefined();
    expect(completionCall![0]).toContain('0 code-done-no-pr');
  });

  it('writeFleetProgress passes code-complete-no-pr status through to FleetProgressWriter.write', async () => {
    const { IssueOrchestrator } = await import('../src/core/issue-orchestrator.js');
    (IssueOrchestrator as ReturnType<typeof vi.fn>).mockImplementationOnce(() => ({
      run: vi.fn().mockResolvedValue({
        issueNumber: 1,
        issueTitle: 'Issue 1',
        success: true,
        codeComplete: true,
        prCreated: false,
        pr: undefined,
        phases: [],
        totalDuration: 100,
        tokenUsage: 100,
      }),
    }));

    const { FleetCheckpointManager: FCM } = await import('../src/core/checkpoint.js');
    (FCM as ReturnType<typeof vi.fn>).mockImplementationOnce(() => ({
      load: vi.fn().mockResolvedValue(undefined),
      isIssueCompleted: vi.fn().mockReturnValue(false),
      setIssueStatus: vi.fn().mockResolvedValue(undefined),
      recordTokenUsage: vi.fn().mockResolvedValue(undefined),
      getIssueStatus: vi.fn().mockReturnValue({ status: 'code-complete-no-pr', lastPhase: 5 }),
    }));

    const { FleetProgressWriter } = await import('../src/core/progress.js');
    const writeMock = vi.fn().mockResolvedValue(undefined);
    (FleetProgressWriter as ReturnType<typeof vi.fn>).mockImplementationOnce(() => ({
      write: writeMock,
      appendEvent: vi.fn().mockResolvedValue(undefined),
    }));

    const config = makeConfig();
    const issues = [makeIssue(1)];
    const { worktreeManager, launcher, platform, logger } = makeMockDeps();

    const fleet = new FleetOrchestrator(
      config, issues, worktreeManager as any, launcher as any, platform as any, logger as any, notifications,
    );
    await fleet.run();

    // Find a write call that includes issue infos (not the incremental empty-ish call)
    const writeCalls = writeMock.mock.calls;
    const finalWriteCall = writeCalls[writeCalls.length - 1];
    const issueInfos = finalWriteCall[0] as Array<{ issueNumber: number; status: string }>;
    const issue1Info = issueInfos.find((i) => i.issueNumber === 1);
    expect(issue1Info).toBeDefined();
    expect(issue1Info!.status).toBe('code-complete-no-pr');
  });
});
