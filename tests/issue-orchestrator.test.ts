import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  BudgetExceededError,
  IssueOrchestrator,
  type IssueResult,
} from '../src/core/issue-orchestrator.js';
import type { CheckpointManager } from '../src/core/checkpoint.js';
import type { AgentLauncher } from '../src/core/agent-launcher.js';
import type { PlatformProvider } from '../src/platform/provider.js';
import type { Logger } from '../src/logging/logger.js';
import type { CadreConfig } from '../src/config/schema.js';
import type { IssueDetail, WorktreeInfo } from '../src/platform/provider.js';

// ── BudgetExceededError ──

describe('BudgetExceededError', () => {
  it('should be an instance of Error', () => {
    const err = new BudgetExceededError();
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(BudgetExceededError);
  });

  it('should have the correct name', () => {
    const err = new BudgetExceededError();
    expect(err.name).toBe('BudgetExceededError');
  });

  it('should have a descriptive message', () => {
    const err = new BudgetExceededError();
    expect(err.message).toBe('Per-issue token budget exceeded');
  });

  it('should be catchable as a BudgetExceededError', () => {
    let caught: unknown;
    try {
      throw new BudgetExceededError();
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(BudgetExceededError);
  });
});

// ── IssueResult interface ──

describe('IssueResult', () => {
  it('should allow budgetExceeded to be undefined', () => {
    const result: IssueResult = {
      issueNumber: 1,
      issueTitle: 'Test issue',
      success: true,
      phases: [],
      totalDuration: 0,
      tokenUsage: 0,
    };
    expect(result.budgetExceeded).toBeUndefined();
  });

  it('should allow budgetExceeded to be true', () => {
    const result: IssueResult = {
      issueNumber: 1,
      issueTitle: 'Test issue',
      success: false,
      phases: [],
      totalDuration: 0,
      tokenUsage: 0,
      budgetExceeded: true,
    };
    expect(result.budgetExceeded).toBe(true);
  });

  it('should allow budgetExceeded to be false', () => {
    const result: IssueResult = {
      issueNumber: 1,
      issueTitle: 'Test issue',
      success: true,
      phases: [],
      totalDuration: 0,
      tokenUsage: 0,
      budgetExceeded: false,
    };
    expect(result.budgetExceeded).toBe(false);
  });
});

// ── IssueOrchestrator ──

function makeLogger(): Logger {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    child: vi.fn().mockReturnThis(),
  } as unknown as Logger;
}

function makeCheckpoint(overrides: Partial<CheckpointManager> = {}): CheckpointManager {
  const state = {
    issueNumber: 42,
    version: 1,
    currentPhase: 0,
    currentTask: null,
    completedPhases: [],
    completedTasks: [],
    failedTasks: [],
    blockedTasks: [],
    phaseOutputs: {},
    tokenUsage: { total: 0, byPhase: {}, byAgent: {} },
    worktreePath: '',
    branchName: '',
    baseCommit: '',
    startedAt: new Date().toISOString(),
    lastCheckpoint: new Date().toISOString(),
    resumeCount: 0,
  };

  return {
    getState: vi.fn(() => state),
    getResumePoint: vi.fn(() => ({ phase: 1, taskId: null })),
    isPhaseCompleted: vi.fn(() => false),
    isTaskCompleted: vi.fn(() => false),
    startPhase: vi.fn(async () => {}),
    completePhase: vi.fn(async () => {}),
    startTask: vi.fn(async () => {}),
    completeTask: vi.fn(async () => {}),
    blockTask: vi.fn(async () => {}),
    failTask: vi.fn(async () => {}),
    recordTokenUsage: vi.fn(async () => {}),
    ...overrides,
  } as unknown as CheckpointManager;
}

function makeLauncher(): AgentLauncher {
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
  } as unknown as AgentLauncher;
}

function makePlatform(): PlatformProvider {
  return {
    issueLinkSuffix: vi.fn(() => 'Closes #42'),
    createPullRequest: vi.fn(async () => ({ number: 1, url: 'https://github.com/test/pr/1' })),
  } as unknown as PlatformProvider;
}

function makeConfig(tokenBudget?: number): CadreConfig {
  return {
    projectName: 'test-project',
    platform: 'github',
    repository: 'owner/repo',
    repoPath: '/tmp/repo',
    baseBranch: 'main',
    issues: { ids: [42] },
    branchTemplate: 'cadre/issue-{issue}',
    commits: {
      conventional: true,
      sign: false,
      commitPerPhase: false,
      squashBeforePR: false,
    },
    pullRequest: {
      autoCreate: false,
      draft: true,
      labels: [],
      reviewers: [],
      linkIssue: false,
    },
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
    environment: {
      inheritShellPath: true,
      extraPath: [],
    },
  } as CadreConfig;
}

function makeIssue(): IssueDetail {
  return {
    number: 42,
    title: 'Test issue',
    body: 'Test body',
    labels: [],
    assignees: [],
    state: 'open',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    url: 'https://github.com/owner/repo/issues/42',
  };
}

describe('IssueOrchestrator', () => {
  let tempDir: string;
  let worktreePath: string;

  beforeEach(async () => {
    tempDir = join(tmpdir(), `cadre-orch-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
    worktreePath = join(tempDir, 'worktree');
    await mkdir(worktreePath, { recursive: true });
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  function makeWorktree(): WorktreeInfo {
    return {
      path: worktreePath,
      branch: 'cadre/issue-42',
      baseCommit: 'abc123',
      issueNumber: 42,
    } as unknown as WorktreeInfo;
  }

  function makeOrchestrator(
    config: CadreConfig,
    checkpoint: CheckpointManager,
    launcher: AgentLauncher,
    logger: Logger,
  ): IssueOrchestrator {
    return new IssueOrchestrator(
      config,
      makeIssue(),
      makeWorktree(),
      checkpoint,
      launcher,
      makePlatform(),
      logger,
    );
  }

  describe('run() with all phases already completed', () => {
    it('should return success without executing any agents', async () => {
      const checkpoint = makeCheckpoint({
        isPhaseCompleted: vi.fn(() => true),
      });
      const launcher = makeLauncher();
      const logger = makeLogger();
      const orchestrator = makeOrchestrator(makeConfig(), checkpoint, launcher, logger);

      const result = await orchestrator.run();

      expect(result.success).toBe(true);
      expect(result.issueNumber).toBe(42);
      expect(result.issueTitle).toBe('Test issue');
      expect(result.budgetExceeded).toBeUndefined();
      expect(launcher.launchAgent).not.toHaveBeenCalled();
    });

    it('should return all 5 skipped phases', async () => {
      const checkpoint = makeCheckpoint({
        isPhaseCompleted: vi.fn(() => true),
      });
      const orchestrator = makeOrchestrator(makeConfig(), checkpoint, makeLauncher(), makeLogger());

      const result = await orchestrator.run();

      expect(result.phases).toHaveLength(5);
      expect(result.phases.every((p) => p.success)).toBe(true);
    });
  });

  describe('run() with budget exceeded', () => {
    it('should return budgetExceeded: true when BudgetExceededError is thrown in executePhase', async () => {
      const checkpoint = makeCheckpoint({
        isPhaseCompleted: vi.fn(() => false),
      });
      (checkpoint.getState as ReturnType<typeof vi.fn>).mockReturnValue({
        issueNumber: 42,
        version: 1,
        currentPhase: 1,
        currentTask: null,
        completedPhases: [],
        completedTasks: [],
        failedTasks: [],
        blockedTasks: [],
        phaseOutputs: {},
        tokenUsage: { total: 0, byPhase: {}, byAgent: {} },
        worktreePath: worktreePath,
        branchName: 'cadre/issue-42',
        baseCommit: 'abc123',
        startedAt: new Date().toISOString(),
        lastCheckpoint: new Date().toISOString(),
        resumeCount: 0,
      });

      const launcher = makeLauncher();
      const logger = makeLogger();
      const orchestrator = makeOrchestrator(makeConfig(100), checkpoint, launcher, logger);

      // Spy on the private executePhase to throw BudgetExceededError
      vi.spyOn(orchestrator as unknown as { executePhase: () => Promise<unknown> }, 'executePhase')
        .mockRejectedValue(new BudgetExceededError());

      const result = await orchestrator.run();

      expect(result.success).toBe(false);
      expect(result.budgetExceeded).toBe(true);
      expect(result.error).toBe('Per-issue token budget exceeded');
    });

    it('should log a resume guidance message when budget is exceeded', async () => {
      const checkpoint = makeCheckpoint({
        isPhaseCompleted: vi.fn(() => false),
      });
      (checkpoint.getState as ReturnType<typeof vi.fn>).mockReturnValue({
        issueNumber: 42,
        version: 1,
        currentPhase: 1,
        currentTask: null,
        completedPhases: [],
        completedTasks: [],
        failedTasks: [],
        blockedTasks: [],
        phaseOutputs: {},
        tokenUsage: { total: 0, byPhase: {}, byAgent: {} },
        worktreePath: worktreePath,
        branchName: 'cadre/issue-42',
        baseCommit: 'abc123',
        startedAt: new Date().toISOString(),
        lastCheckpoint: new Date().toISOString(),
        resumeCount: 0,
      });

      const logger = makeLogger();
      const orchestrator = makeOrchestrator(makeConfig(100), makeCheckpoint({
        isPhaseCompleted: vi.fn(() => false),
        getState: vi.fn(() => ({
          issueNumber: 42,
          version: 1,
          currentPhase: 1,
          currentTask: null,
          completedPhases: [],
          completedTasks: [],
          failedTasks: [],
          blockedTasks: [],
          phaseOutputs: {},
          tokenUsage: { total: 0, byPhase: {}, byAgent: {} },
          worktreePath: worktreePath,
          branchName: 'cadre/issue-42',
          baseCommit: 'abc123',
          startedAt: new Date().toISOString(),
          lastCheckpoint: new Date().toISOString(),
          resumeCount: 0,
        })),
      }), makeLauncher(), logger);

      vi.spyOn(orchestrator as unknown as { executePhase: () => Promise<unknown> }, 'executePhase')
        .mockRejectedValue(new BudgetExceededError());

      await orchestrator.run();

      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('--resume'),
        expect.anything(),
      );
    });

    it('should set budgetExceeded on checkpoint state when budget is exceeded', async () => {
      const cpState = {
        issueNumber: 42,
        version: 1,
        currentPhase: 1,
        currentTask: null,
        completedPhases: [],
        completedTasks: [],
        failedTasks: [],
        blockedTasks: [],
        phaseOutputs: {},
        tokenUsage: { total: 0, byPhase: {}, byAgent: {} },
        worktreePath: worktreePath,
        branchName: 'cadre/issue-42',
        baseCommit: 'abc123',
        startedAt: new Date().toISOString(),
        lastCheckpoint: new Date().toISOString(),
        resumeCount: 0,
        budgetExceeded: undefined as boolean | undefined,
      };

      const checkpoint = makeCheckpoint({
        isPhaseCompleted: vi.fn(() => false),
        getState: vi.fn(() => cpState),
        recordTokenUsage: vi.fn(async () => {}),
      });

      const orchestrator = makeOrchestrator(makeConfig(100), checkpoint, makeLauncher(), makeLogger());

      vi.spyOn(orchestrator as unknown as { executePhase: () => Promise<unknown> }, 'executePhase')
        .mockRejectedValue(new BudgetExceededError());

      await orchestrator.run();

      expect(cpState.budgetExceeded).toBe(true);
    });

    it('should re-throw non-budget errors from executePhase', async () => {
      const checkpoint = makeCheckpoint({
        isPhaseCompleted: vi.fn(() => false),
        getState: vi.fn(() => ({
          issueNumber: 42,
          version: 1,
          currentPhase: 1,
          currentTask: null,
          completedPhases: [],
          completedTasks: [],
          failedTasks: [],
          blockedTasks: [],
          phaseOutputs: {},
          tokenUsage: { total: 0, byPhase: {}, byAgent: {} },
          worktreePath: worktreePath,
          branchName: 'cadre/issue-42',
          baseCommit: 'abc123',
          startedAt: new Date().toISOString(),
          lastCheckpoint: new Date().toISOString(),
          resumeCount: 0,
        })),
      });

      const orchestrator = makeOrchestrator(makeConfig(), checkpoint, makeLauncher(), makeLogger());

      vi.spyOn(orchestrator as unknown as { executePhase: () => Promise<unknown> }, 'executePhase')
        .mockRejectedValue(new Error('unexpected system error'));

      await expect(orchestrator.run()).rejects.toThrow('unexpected system error');
    });
  });

  describe('buildResult', () => {
    it('should include budgetExceeded in returned IssueResult when provided', async () => {
      const checkpoint = makeCheckpoint({
        isPhaseCompleted: vi.fn(() => false),
        getState: vi.fn(() => ({
          issueNumber: 42,
          version: 1,
          currentPhase: 1,
          currentTask: null,
          completedPhases: [],
          completedTasks: [],
          failedTasks: [],
          blockedTasks: [],
          phaseOutputs: {},
          tokenUsage: { total: 0, byPhase: {}, byAgent: {} },
          worktreePath: worktreePath,
          branchName: 'cadre/issue-42',
          baseCommit: 'abc123',
          startedAt: new Date().toISOString(),
          lastCheckpoint: new Date().toISOString(),
          resumeCount: 0,
        })),
      });

      const orchestrator = makeOrchestrator(makeConfig(100), checkpoint, makeLauncher(), makeLogger());

      vi.spyOn(orchestrator as unknown as { executePhase: () => Promise<unknown> }, 'executePhase')
        .mockRejectedValue(new BudgetExceededError());

      const result = await orchestrator.run();

      expect(result).toMatchObject({
        issueNumber: 42,
        issueTitle: 'Test issue',
        success: false,
        budgetExceeded: true,
        error: 'Per-issue token budget exceeded',
      });
    });
  });
});
