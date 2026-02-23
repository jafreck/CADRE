import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FleetOrchestrator } from '../src/core/fleet-orchestrator.js';
import { NotificationManager } from '../src/notifications/manager.js';
import { FleetCheckpointManager } from '../src/core/checkpoint.js';
import { FleetProgressWriter } from '../src/core/progress.js';
import type { CadreConfig } from '../src/config/schema.js';
import type { IssueDetail } from '../src/platform/provider.js';

// Mock heavy dependencies so tests stay fast and isolated
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
      issueTitle: 'Issue 1',
      success: true,
      codeComplete: true,
      prCreated: false,
      pr: undefined,
      phases: [],
      totalDuration: 100,
      tokenUsage: 500,
    }),
  })),
}));
vi.mock('../src/core/phase-registry.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/core/phase-registry.js')>();
  return {
    ...actual,
    getPhaseCount: vi.fn().mockReturnValue(5),
  };
});
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

function makeDeps() {
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

describe('PR failure path', () => {
  let notifications: NotificationManager;

  beforeEach(() => {
    vi.clearAllMocks();
    notifications = { dispatch: vi.fn().mockResolvedValue(undefined) } as unknown as NotificationManager;
  });

  it('PR creation failure → codeComplete true, prCreated false, not in prsCreated', async () => {
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
    const { worktreeManager, launcher, platform, logger } = makeDeps();

    const fleet = new FleetOrchestrator(
      config, [makeIssue(1)],
      worktreeManager as any, launcher as any, platform as any, logger as any,
      notifications,
    );
    const result = await fleet.run();

    expect(result.codeComplete ?? result.codeDoneNoPR.length > 0).toBeTruthy();
    expect(result.prsCreated).toHaveLength(0);
    expect(result.codeDoneNoPR).toHaveLength(1);
    expect(result.codeDoneNoPR[0]).toMatchObject({ issueNumber: 1 });
    expect(result.success).toBe(true);
  });

  it('PR creation success → prCreated true, appears in prsCreated', async () => {
    const { IssueOrchestrator } = await import('../src/core/issue-orchestrator.js');
    const fakePR = {
      number: 99,
      url: 'https://github.com/owner/repo/pull/99',
      title: 'feat: implement changes',
      headBranch: 'cadre/issue-1',
      baseBranch: 'main',
    };
    (IssueOrchestrator as ReturnType<typeof vi.fn>).mockImplementationOnce(() => ({
      run: vi.fn().mockResolvedValue({
        issueNumber: 1,
        issueTitle: 'Issue 1',
        success: true,
        codeComplete: true,
        prCreated: true,
        pr: fakePR,
        phases: [],
        totalDuration: 100,
        tokenUsage: 500,
      }),
    }));

    const config = makeConfig();
    const { worktreeManager, launcher, platform, logger } = makeDeps();

    const fleet = new FleetOrchestrator(
      config, [makeIssue(1)],
      worktreeManager as any, launcher as any, platform as any, logger as any,
      notifications,
    );
    const result = await fleet.run();

    expect(result.prsCreated).toHaveLength(1);
    expect(result.prsCreated[0]).toMatchObject({ number: 99 });
    expect(result.codeDoneNoPR).toHaveLength(0);
    expect(result.success).toBe(true);
  });

  describe('codeDoneNoPR aggregation in FleetResult', () => {
    it('places codeComplete+!prCreated issue into codeDoneNoPR and not into prsCreated or failedIssues', async () => {
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
      const { worktreeManager, launcher, platform, logger } = makeDeps();

      const fleet = new FleetOrchestrator(
        config, [makeIssue(1)],
        worktreeManager as any, launcher as any, platform as any, logger as any,
        notifications,
      );
      const result = await fleet.run();

      expect(result.codeDoneNoPR).toHaveLength(1);
      expect(result.codeDoneNoPR[0]).toEqual({ issueNumber: 1, issueTitle: 'Issue 1' });
      expect(result.prsCreated).toHaveLength(0);
      expect(result.failedIssues).toHaveLength(0);
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
      const { worktreeManager, launcher, platform, logger } = makeDeps();

      const fleet = new FleetOrchestrator(
        config, [makeIssue(1)],
        worktreeManager as any, launcher as any, platform as any, logger as any,
        notifications,
      );
      await fleet.run();

      const checkpointInstance = (FleetCheckpointManager as unknown as ReturnType<typeof vi.fn>).mock.results[0].value;
      const statusCalls = checkpointInstance.setIssueStatus.mock.calls as unknown[][];
      const terminalCall = statusCalls.find((args) => args[1] !== 'in-progress');
      expect(terminalCall).toBeDefined();
      expect(terminalCall![1]).toBe('code-complete-no-pr');
    });
  });

  describe('writeFleetProgress passes code-complete-no-pr status to FleetProgressWriter', () => {
    it('calls FleetProgressWriter.write with code-complete-no-pr status for codeComplete+!prCreated issues', async () => {
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

      // Make getIssueStatus return code-complete-no-pr so writeFleetProgress picks it up
      const { FleetCheckpointManager: FCM } = await import('../src/core/checkpoint.js');
      (FCM as ReturnType<typeof vi.fn>).mockImplementationOnce(() => ({
        load: vi.fn().mockResolvedValue(undefined),
        isIssueCompleted: vi.fn().mockReturnValue(false),
        setIssueStatus: vi.fn().mockResolvedValue(undefined),
        recordTokenUsage: vi.fn().mockResolvedValue(undefined),
        getIssueStatus: vi.fn().mockReturnValue({ status: 'code-complete-no-pr', lastPhase: 5 }),
      }));

      const config = makeConfig();
      const { worktreeManager, launcher, platform, logger } = makeDeps();

      const fleet = new FleetOrchestrator(
        config, [makeIssue(1)],
        worktreeManager as any, launcher as any, platform as any, logger as any,
        notifications,
      );
      await fleet.run();

      const progressInstance = (FleetProgressWriter as unknown as ReturnType<typeof vi.fn>).mock.results[0].value;
      const writeCalls = progressInstance.write.mock.calls as unknown[][];
      // Last call to write is from writeFleetProgress (final write)
      const finalWriteCall = writeCalls[writeCalls.length - 1];
      const issueInfos = finalWriteCall[0] as Array<{ issueNumber: number; status: string }>;
      const issue1Info = issueInfos.find((i) => i.issueNumber === 1);
      expect(issue1Info).toBeDefined();
      expect(issue1Info!.status).toBe('code-complete-no-pr');
    });

    it('calls FleetProgressWriter.write with completed status for prCreated issues', async () => {
      const { IssueOrchestrator } = await import('../src/core/issue-orchestrator.js');
      const fakePR = {
        number: 42,
        url: 'https://github.com/owner/repo/pull/42',
        title: 'feat: fix issue',
        headBranch: 'cadre/issue-1',
        baseBranch: 'main',
      };
      (IssueOrchestrator as ReturnType<typeof vi.fn>).mockImplementationOnce(() => ({
        run: vi.fn().mockResolvedValue({
          issueNumber: 1,
          issueTitle: 'Issue 1',
          success: true,
          codeComplete: true,
          prCreated: true,
          pr: fakePR,
          phases: [],
          totalDuration: 100,
          tokenUsage: 500,
        }),
      }));

      const { FleetCheckpointManager: FCM } = await import('../src/core/checkpoint.js');
      (FCM as ReturnType<typeof vi.fn>).mockImplementationOnce(() => ({
        load: vi.fn().mockResolvedValue(undefined),
        isIssueCompleted: vi.fn().mockReturnValue(false),
        setIssueStatus: vi.fn().mockResolvedValue(undefined),
        recordTokenUsage: vi.fn().mockResolvedValue(undefined),
        getIssueStatus: vi.fn().mockReturnValue({ status: 'completed', lastPhase: 5 }),
      }));

      const config = makeConfig();
      const { worktreeManager, launcher, platform, logger } = makeDeps();

      const fleet = new FleetOrchestrator(
        config, [makeIssue(1)],
        worktreeManager as any, launcher as any, platform as any, logger as any,
        notifications,
      );
      await fleet.run();

      const progressInstance = (FleetProgressWriter as unknown as ReturnType<typeof vi.fn>).mock.results[0].value;
      const writeCalls = progressInstance.write.mock.calls as unknown[][];
      const finalWriteCall = writeCalls[writeCalls.length - 1];
      const issueInfos = finalWriteCall[0] as Array<{ issueNumber: number; status: string }>;
      const issue1Info = issueInfos.find((i) => i.issueNumber === 1);
      expect(issue1Info).toBeDefined();
      expect(issue1Info!.status).toBe('completed');
    });
  });

  describe('fleet completion event log includes codeDoneNoPR count', () => {
    it('appendEvent is called with codeDoneNoPR count in the completion message', async () => {
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
      const { worktreeManager, launcher, platform, logger } = makeDeps();

      const fleet = new FleetOrchestrator(
        config, [makeIssue(1)],
        worktreeManager as any, launcher as any, platform as any, logger as any,
        notifications,
      );
      await fleet.run();

      const progressInstance = (FleetProgressWriter as unknown as ReturnType<typeof vi.fn>).mock.results[0].value;
      const appendEventCalls = progressInstance.appendEvent.mock.calls as unknown[][];
      const completionCall = appendEventCalls.find(
        (args) => typeof args[0] === 'string' && (args[0] as string).includes('Fleet completed'),
      );
      expect(completionCall).toBeDefined();
      const message = completionCall![0] as string;
      // Should include codeDoneNoPR count (1 in this case)
      expect(message).toMatch(/1 code-done-no-pr/);
    });

    it('appendEvent completion message shows 0 code-done-no-pr when PR was created', async () => {
      const { IssueOrchestrator } = await import('../src/core/issue-orchestrator.js');
      const fakePR = {
        number: 99,
        url: 'https://github.com/owner/repo/pull/99',
        title: 'feat: fix',
        headBranch: 'cadre/issue-1',
        baseBranch: 'main',
      };
      (IssueOrchestrator as ReturnType<typeof vi.fn>).mockImplementationOnce(() => ({
        run: vi.fn().mockResolvedValue({
          issueNumber: 1,
          issueTitle: 'Issue 1',
          success: true,
          codeComplete: true,
          prCreated: true,
          pr: fakePR,
          phases: [],
          totalDuration: 100,
          tokenUsage: 500,
        }),
      }));

      const config = makeConfig();
      const { worktreeManager, launcher, platform, logger } = makeDeps();

      const fleet = new FleetOrchestrator(
        config, [makeIssue(1)],
        worktreeManager as any, launcher as any, platform as any, logger as any,
        notifications,
      );
      await fleet.run();

      const progressInstance = (FleetProgressWriter as unknown as ReturnType<typeof vi.fn>).mock.results[0].value;
      const appendEventCalls = progressInstance.appendEvent.mock.calls as unknown[][];
      const completionCall = appendEventCalls.find(
        (args) => typeof args[0] === 'string' && (args[0] as string).includes('Fleet completed'),
      );
      expect(completionCall).toBeDefined();
      const message = completionCall![0] as string;
      expect(message).toMatch(/0 code-done-no-pr/);
      expect(message).toMatch(/1 PRs/);
    });
  });
});
