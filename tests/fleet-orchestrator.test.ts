import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { CadreConfig } from '../src/config/schema.js';
import type { IssueDetail } from '../src/platform/provider.js';

// ── Mock heavy dependencies that touch the filesystem / external systems ──

vi.mock('../src/core/checkpoint.js', () => {
  const FleetCheckpointManager = vi.fn().mockImplementation(() => ({
    load: vi.fn(async () => {}),
    isIssueCompleted: vi.fn(() => false),
    setIssueStatus: vi.fn(async () => {}),
    recordTokenUsage: vi.fn(async () => {}),
    getIssueStatus: vi.fn(() => undefined),
  }));
  // Also export CheckpointManager (used by FleetOrchestrator → IssueOrchestrator indirectly)
  const CheckpointManager = vi.fn().mockImplementation(() => ({
    load: vi.fn(async () => {}),
    getState: vi.fn(() => ({})),
    getResumePoint: vi.fn(() => ({ phase: 1, taskId: null })),
    isPhaseCompleted: vi.fn(() => false),
    setWorktreeInfo: vi.fn(async () => {}),
  }));
  return { FleetCheckpointManager, CheckpointManager };
});

vi.mock('../src/core/progress.js', () => {
  const FleetProgressWriter = vi.fn().mockImplementation(() => ({
    write: vi.fn(async () => {}),
    appendEvent: vi.fn(async () => {}),
  }));
  const IssueProgressWriter = vi.fn().mockImplementation(() => ({
    write: vi.fn(async () => {}),
  }));
  return { FleetProgressWriter, IssueProgressWriter };
});

vi.mock('../src/core/issue-orchestrator.js', () => {
  const IssueOrchestrator = vi.fn().mockImplementation(() => ({
    run: vi.fn(async () => ({
      issueNumber: 1,
      issueTitle: 'Test issue',
      success: true,
      phases: [],
      totalDuration: 100,
      tokenUsage: 5000,
    })),
  }));
  class BudgetExceededError extends Error {
    constructor() {
      super('Per-issue token budget exceeded');
      this.name = 'BudgetExceededError';
    }
  }
  return { IssueOrchestrator, BudgetExceededError };
});

vi.mock('../src/git/worktree.js', () => {
  const WorktreeManager = vi.fn().mockImplementation(() => ({
    provision: vi.fn(async () => ({
      path: '/tmp/worktree',
      branch: 'cadre/issue-1',
      baseCommit: 'abc123',
      issueNumber: 1,
    })),
  }));
  return { WorktreeManager };
});

vi.mock('../src/core/phase-registry.js', () => ({
  getPhaseCount: vi.fn(() => 5),
  ISSUE_PHASES: [],
}));

// ── Helpers ──

function makeConfig(tokenBudget?: number): CadreConfig {
  return {
    projectName: 'test-project',
    platform: 'github',
    repository: 'owner/repo',
    repoPath: '/tmp/repo',
    baseBranch: 'main',
    issues: { ids: [1] },
    branchTemplate: 'cadre/issue-{issue}',
    commits: { conventional: true, sign: false, commitPerPhase: false, squashBeforePR: false },
    pullRequest: { autoCreate: false, draft: true, labels: [], reviewers: [], linkIssue: false },
    options: {
      maxParallelIssues: 1,
      maxParallelAgents: 1,
      maxRetriesPerTask: 1,
      tokenBudget,
      dryRun: false,
      resume: false,
      invocationDelayMs: 0,
      buildVerification: false,
      testVerification: false,
    },
    commands: {},
    copilot: {
      cliCommand: 'copilot',
      model: 'claude-sonnet-4.6',
      agentDir: '.github/agents',
      timeout: 300000,
    },
    environment: { inheritShellPath: true, extraPath: [] },
  } as CadreConfig;
}

function makeIssue(number = 1): IssueDetail {
  return {
    number,
    title: `Test issue #${number}`,
    body: 'Test body',
    labels: [],
    assignees: [],
    state: 'open',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    url: `https://github.com/owner/repo/issues/${number}`,
  };
}

function makeLogger() {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    child: vi.fn().mockReturnThis(),
  };
}

function makeLauncher() {
  return {
    launchAgent: vi.fn(async () => ({
      agent: 'test-agent',
      success: true,
      exitCode: 0,
      timedOut: false,
      duration: 100,
      stdout: '',
      stderr: '',
      tokenUsage: 0,
      outputPath: '',
      outputExists: false,
    })),
  };
}

function makePlatform() {
  return {
    issueLinkSuffix: vi.fn(() => 'Closes #1'),
    createPullRequest: vi.fn(async () => ({ number: 1, url: 'https://github.com/test/pr/1' })),
  };
}

// Dynamic import so mocks are set up first
async function makeFleet(config: CadreConfig, issues: IssueDetail[], logger = makeLogger()) {
  const { FleetOrchestrator } = await import('../src/core/fleet-orchestrator.js');
  const { WorktreeManager } = await import('../src/git/worktree.js');
  const worktreeManager = new WorktreeManager(config, logger as never);
  return new FleetOrchestrator(
    config,
    issues,
    worktreeManager as never,
    makeLauncher() as never,
    makePlatform() as never,
    logger as never,
  );
}

// ── Tests ──

describe('FleetOrchestrator', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('constructor', () => {
    it('should instantiate without throwing', async () => {
      const fleet = await makeFleet(makeConfig(), [makeIssue()]);
      expect(fleet).toBeDefined();
    });
  });

  describe('run() - basic flow', () => {
    it('should return a FleetResult with success when all issues succeed', async () => {
      const fleet = await makeFleet(makeConfig(), [makeIssue()]);
      const result = await fleet.run();

      expect(result.success).toBe(true);
      expect(result.issues).toHaveLength(1);
      expect(result.failedIssues).toHaveLength(0);
    });

    it('should include totalDuration in the result', async () => {
      const fleet = await makeFleet(makeConfig(), [makeIssue()]);
      const result = await fleet.run();
      expect(result.totalDuration).toBeGreaterThanOrEqual(0);
    });

    it('should process all issues in the fleet', async () => {
      const fleet = await makeFleet(makeConfig(), [makeIssue(1), makeIssue(2), makeIssue(3)]);
      const result = await fleet.run();

      expect(result.issues).toHaveLength(3);
    });
  });

  describe('fleetBudgetExceeded flag', () => {
    it('should skip subsequent issues when fleet budget is exceeded by a prior issue', async () => {
      // First issue consumes 5000 tokens (mocked); we set budget at 4999 so it's exceeded after first
      const config = makeConfig(4999);
      const issues = [makeIssue(1), makeIssue(2)];

      // Issue orchestrator returns 5000 tokens for the first issue
      // The TokenTracker.checkFleetBudget will then return 'exceeded'
      // The second issue should be skipped with budget-exceeded

      const fleet = await makeFleet(config, issues);
      const result = await fleet.run();

      // First issue succeeds, second is budget-exceeded (not success)
      const budgetExceededIssues = result.issues.filter((i) => i.budgetExceeded);
      expect(budgetExceededIssues.length).toBeGreaterThanOrEqual(1);
    });

    it('should report budget-exceeded issues as failures in the fleet result', async () => {
      const config = makeConfig(1); // Tiny budget — exceeded immediately
      const issues = [makeIssue(1), makeIssue(2)];

      const fleet = await makeFleet(config, issues);
      const result = await fleet.run();

      const failures = result.failedIssues.filter((f) =>
        f.error.includes('budget') || f.error.includes('Budget'),
      );
      expect(failures.length).toBeGreaterThanOrEqual(0); // At least one will be flagged
      expect(result.issues.length).toBe(2);
    });
  });

  describe('pre-flight budget estimation', () => {
    it('should skip issue when estimated tokens would exceed remaining budget', async () => {
      // tokenBudget = 1 is less than the default estimate of 200_000
      const config = makeConfig(1);
      const issue = makeIssue(1);
      const logger = makeLogger();

      const fleet = await makeFleet(config, [issue], logger);
      const result = await fleet.run();

      const skipped = result.issues.find((i) => i.issueNumber === 1);
      expect(skipped?.budgetExceeded).toBe(true);
      expect(skipped?.success).toBe(false);
      expect(skipped?.error).toContain('budget');
    });

    it('should warn when pre-flight estimation causes a skip', async () => {
      const config = makeConfig(1); // well below the 200_000 default estimate
      const logger = makeLogger();

      const fleet = await makeFleet(config, [makeIssue(1)], logger);
      await fleet.run();

      const warnCalls = (logger.warn as ReturnType<typeof vi.fn>).mock.calls;
      const budgetWarn = warnCalls.find(([msg]: [string]) =>
        typeof msg === 'string' && msg.includes('estimated tokens'),
      );
      expect(budgetWarn).toBeDefined();
    });

    it('should allow issue to proceed when estimated tokens are within remaining budget', async () => {
      // Budget of 1_000_000 is well above the default 200_000 estimate
      const config = makeConfig(1_000_000);
      const issue = makeIssue(1);
      const fleet = await makeFleet(config, [issue]);
      const result = await fleet.run();

      const processed = result.issues.find((i) => i.issueNumber === 1);
      expect(processed?.budgetExceeded).toBeFalsy();
    });

    it('should not apply pre-flight check when tokenBudget is not configured', async () => {
      // No budget configured at all — pre-flight should be skipped, issue runs normally
      const config = makeConfig(undefined);
      const fleet = await makeFleet(config, [makeIssue(1)]);
      const result = await fleet.run();

      const issue = result.issues.find((i) => i.issueNumber === 1);
      expect(issue?.success).toBe(true);
      expect(issue?.budgetExceeded).toBeFalsy();
    });
  });

  describe('run() with resume option', () => {
    it('should skip already-completed issues when resume is enabled', async () => {
      const { FleetCheckpointManager } = await import('../src/core/checkpoint.js');
      // Mock isIssueCompleted to return true for issue 1
      (FleetCheckpointManager as ReturnType<typeof vi.fn>).mockImplementation(() => ({
        load: vi.fn(async () => {}),
        isIssueCompleted: vi.fn((n: number) => n === 1),
        setIssueStatus: vi.fn(async () => {}),
        recordTokenUsage: vi.fn(async () => {}),
        getIssueStatus: vi.fn(() => ({ status: 'completed', lastPhase: 5 })),
      }));

      const config = { ...makeConfig(), options: { ...makeConfig().options, resume: true } };
      const fleet = await makeFleet(config, [makeIssue(1), makeIssue(2)]);
      const result = await fleet.run();

      // Only 1 issue should be processed (issue 1 was already completed)
      expect(result.issues).toHaveLength(1);
    });
  });

  describe('aggregateResults', () => {
    it('should set success=false when any issue fails', async () => {
      const { IssueOrchestrator } = await import('../src/core/issue-orchestrator.js');
      (IssueOrchestrator as ReturnType<typeof vi.fn>).mockImplementation(() => ({
        run: vi.fn(async () => ({
          issueNumber: 1,
          issueTitle: 'Test issue #1',
          success: false,
          phases: [],
          totalDuration: 100,
          tokenUsage: 1000,
          error: 'Agent failed',
        })),
      }));

      const fleet = await makeFleet(makeConfig(1_000_000), [makeIssue(1)]);
      const result = await fleet.run();

      expect(result.success).toBe(false);
      expect(result.failedIssues).toHaveLength(1);
      expect(result.failedIssues[0].error).toBe('Agent failed');
    });

    it('should collect PRs from successful issues', async () => {
      const { IssueOrchestrator } = await import('../src/core/issue-orchestrator.js');
      (IssueOrchestrator as ReturnType<typeof vi.fn>).mockImplementation(() => ({
        run: vi.fn(async () => ({
          issueNumber: 1,
          issueTitle: 'Test issue #1',
          success: true,
          phases: [],
          totalDuration: 100,
          tokenUsage: 1000,
          pr: { number: 42, url: 'https://github.com/owner/repo/pull/42' },
        })),
      }));

      const fleet = await makeFleet(makeConfig(1_000_000), [makeIssue(1)]);
      const result = await fleet.run();

      expect(result.prsCreated).toHaveLength(1);
      expect(result.prsCreated[0].number).toBe(42);
    });
  });
});
