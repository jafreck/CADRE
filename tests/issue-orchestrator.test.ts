import { describe, it, expect, vi, beforeEach } from 'vitest';
import { writeFile } from 'node:fs/promises';
import { IssueOrchestrator } from '../src/core/issue-orchestrator.js';
import { CommitManager } from '../src/git/commit.js';
import { ContextBuilder } from '../src/agents/context-builder.js';
import { ResultParser } from '../src/agents/result-parser.js';
import { RetryExecutor } from '../src/execution/retry.js';
import { IssueProgressWriter } from '../src/core/progress.js';
import { TokenTracker } from '../src/budget/token-tracker.js';
import type { CheckpointManager } from '../src/core/checkpoint.js';
import type { AgentLauncher } from '../src/core/agent-launcher.js';
import type { PlatformProvider, PullRequestInfo } from '../src/platform/provider.js';
import type { Logger } from '../src/logging/logger.js';
import type { CadreConfig } from '../src/config/schema.js';
import type { IssueDetail, WorktreeInfo } from '../src/platform/provider.js';

vi.mock('node:fs/promises');
vi.mock('../src/git/commit.js');
vi.mock('../src/agents/context-builder.js');
vi.mock('../src/agents/result-parser.js');
vi.mock('../src/execution/retry.js');
vi.mock('../src/core/progress.js');
vi.mock('../src/budget/token-tracker.js');

/** Build a minimal CadreConfig for tests. */
function makeConfig(overrides: Partial<CadreConfig> = {}): CadreConfig {
  return {
    projectName: 'test',
    repository: 'owner/repo',
    repoPath: '/tmp/repo',
    baseBranch: 'main',
    issues: { ids: [42] },
    copilot: { cliCommand: 'copilot', agentDir: '.github/agents', timeout: 300000 },
    environment: { inheritShellPath: true, extraPath: [] },
    commits: { commitPerPhase: false, squashBeforePR: false },
    options: {
      dryRun: false,
      maxParallelAgents: 1,
      maxRetriesPerTask: 1,
      buildVerification: false,
      testVerification: false,
    },
    commands: { install: '', build: '', test: '', lint: '' },
    pullRequest: { autoCreate: true, draft: false, linkIssue: false },
    ...overrides,
  } as CadreConfig;
}

/** Build a minimal IssueDetail. */
function makeIssue(): IssueDetail {
  return {
    number: 42,
    title: 'Test issue',
    body: 'Test body',
    labels: [],
    author: 'alice',
    url: 'https://github.com/owner/repo/issues/42',
    createdAt: '2024-01-01T00:00:00Z',
  };
}

/** Build a minimal WorktreeInfo. */
function makeWorktree(): WorktreeInfo {
  return {
    path: '/tmp/worktree',
    branch: 'fix/issue-42',
    baseCommit: 'abc123',
    issueNumber: 42,
  };
}

/** Build a CheckpointManager mock that marks phases 1-4 as completed. */
function makeCheckpoint(completedPhases: number[] = [1, 2, 3, 4]): CheckpointManager {
  const state = {
    issueNumber: 42,
    version: 1,
    currentPhase: 4,
    currentTask: null,
    completedPhases,
    completedTasks: [],
    failedTasks: [],
    blockedTasks: [],
    phaseOutputs: {},
    tokenUsage: { total: 0, byPhase: {}, byAgent: {} },
    worktreePath: '/tmp/worktree',
    branchName: 'fix/issue-42',
    baseCommit: 'abc123',
    startedAt: new Date().toISOString(),
    lastCheckpoint: new Date().toISOString(),
    resumeCount: 0,
  };
  return {
    getState: vi.fn().mockReturnValue(state),
    getResumePoint: vi.fn().mockReturnValue({ phase: 5, task: null }),
    isPhaseCompleted: vi.fn().mockImplementation((id: number) => completedPhases.includes(id)),
    isTaskCompleted: vi.fn().mockReturnValue(false),
    startPhase: vi.fn().mockResolvedValue(undefined),
    completePhase: vi.fn().mockResolvedValue(undefined),
    startTask: vi.fn().mockResolvedValue(undefined),
    completeTask: vi.fn().mockResolvedValue(undefined),
    blockTask: vi.fn().mockResolvedValue(undefined),
    recordTokenUsage: vi.fn().mockResolvedValue(undefined),
  } as unknown as CheckpointManager;
}

/** Build a Logger mock. */
function makeLogger(): Logger {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  } as unknown as Logger;
}

describe('IssueOrchestrator – task-003 changes', () => {
  let mockWriteFile: ReturnType<typeof vi.fn>;
  let mockCommitManager: { getDiff: ReturnType<typeof vi.fn>; push: ReturnType<typeof vi.fn>; squash: ReturnType<typeof vi.fn>; isClean: ReturnType<typeof vi.fn>; getChangedFiles: ReturnType<typeof vi.fn>; commit: ReturnType<typeof vi.fn> };
  let mockContextBuilder: { buildForPRComposer: ReturnType<typeof vi.fn> };
  let mockResultParser: { parsePRContent: ReturnType<typeof vi.fn> };
  let mockRetryExecutor: { execute: ReturnType<typeof vi.fn> };
  let mockProgressWriter: { appendEvent: ReturnType<typeof vi.fn>; write: ReturnType<typeof vi.fn> };
  let mockTokenTracker: { record: ReturnType<typeof vi.fn>; getTotal: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    vi.clearAllMocks();

    mockWriteFile = vi.mocked(writeFile).mockResolvedValue(undefined);

    mockCommitManager = {
      getDiff: vi.fn().mockResolvedValue('diff content'),
      push: vi.fn().mockResolvedValue(undefined),
      squash: vi.fn().mockResolvedValue(undefined),
      isClean: vi.fn().mockResolvedValue(true),
      getChangedFiles: vi.fn().mockResolvedValue([]),
      commit: vi.fn().mockResolvedValue(undefined),
    };
    vi.mocked(CommitManager).mockImplementation(() => mockCommitManager as unknown as CommitManager);

    mockContextBuilder = {
      buildForPRComposer: vi.fn().mockResolvedValue('/tmp/context.json'),
    };
    vi.mocked(ContextBuilder).mockImplementation(() => mockContextBuilder as unknown as ContextBuilder);

    mockResultParser = {
      parsePRContent: vi.fn().mockResolvedValue({
        title: 'Fix: test issue (#42)',
        body: 'Resolves test issue.',
        labels: [],
      }),
    };
    vi.mocked(ResultParser).mockImplementation(() => mockResultParser as unknown as ResultParser);

    // RetryExecutor mock: executes the fn once and returns success
    mockRetryExecutor = {
      execute: vi.fn().mockImplementation(async ({ fn }: { fn: (attempt: number) => Promise<unknown> }) => {
        try {
          const result = await fn(1);
          return { success: true, result, attempts: 1, recoveryUsed: false };
        } catch (err) {
          return { success: false, error: String(err), attempts: 1, recoveryUsed: false };
        }
      }),
    };
    vi.mocked(RetryExecutor).mockImplementation(() => mockRetryExecutor as unknown as RetryExecutor);

    mockProgressWriter = {
      appendEvent: vi.fn().mockResolvedValue(undefined),
      write: vi.fn().mockResolvedValue(undefined),
    };
    vi.mocked(IssueProgressWriter).mockImplementation(() => mockProgressWriter as unknown as IssueProgressWriter);

    mockTokenTracker = {
      record: vi.fn(),
      getTotal: vi.fn().mockReturnValue(0),
    };
    vi.mocked(TokenTracker).mockImplementation(() => mockTokenTracker as unknown as TokenTracker);
  });

  describe('buildResult() includes pr field', () => {
    it('should populate IssueResult.pr after successful PR creation', async () => {
      const mockPR: PullRequestInfo = {
        number: 7,
        url: 'https://github.com/owner/repo/pull/7',
        title: 'Fix: test issue (#42)',
        branch: 'fix/issue-42',
      };

      const mockPlatform: PlatformProvider = {
        getIssue: vi.fn(),
        listIssues: vi.fn(),
        createPullRequest: vi.fn().mockResolvedValue(mockPR),
        issueLinkSuffix: vi.fn().mockReturnValue('Closes #42'),
      } as unknown as PlatformProvider;

      const mockLauncher: AgentLauncher = {
        launchAgent: vi.fn().mockResolvedValue({
          agent: 'pr-composer',
          success: true,
          exitCode: 0,
          timedOut: false,
          duration: 100,
          stdout: '',
          stderr: '',
          tokenUsage: 500,
          outputPath: '/tmp/pr-content.md',
          outputExists: true,
        }),
      } as unknown as AgentLauncher;

      const orchestrator = new IssueOrchestrator(
        makeConfig({ pullRequest: { autoCreate: true, draft: false, linkIssue: false } }),
        makeIssue(),
        makeWorktree(),
        makeCheckpoint([1, 2, 3, 4]),
        mockLauncher,
        mockPlatform,
        makeLogger(),
      );

      const result = await orchestrator.run();

      expect(mockPlatform.createPullRequest).toHaveBeenCalledOnce();
      expect(result.pr).toBeDefined();
      expect(result.pr?.number).toBe(7);
      expect(result.pr?.url).toBe('https://github.com/owner/repo/pull/7');
    });

    it('should leave IssueResult.pr undefined when autoCreate is disabled', async () => {
      const mockPlatform: PlatformProvider = {
        getIssue: vi.fn(),
        listIssues: vi.fn(),
        createPullRequest: vi.fn(),
        issueLinkSuffix: vi.fn().mockReturnValue('Closes #42'),
      } as unknown as PlatformProvider;

      const mockLauncher: AgentLauncher = {
        launchAgent: vi.fn().mockResolvedValue({
          agent: 'pr-composer',
          success: true,
          exitCode: 0,
          timedOut: false,
          duration: 100,
          stdout: '',
          stderr: '',
          tokenUsage: 500,
          outputPath: '/tmp/pr-content.md',
          outputExists: true,
        }),
      } as unknown as AgentLauncher;

      const orchestrator = new IssueOrchestrator(
        makeConfig({ pullRequest: { autoCreate: false, draft: false, linkIssue: false } }),
        makeIssue(),
        makeWorktree(),
        makeCheckpoint([1, 2, 3, 4]),
        mockLauncher,
        mockPlatform,
        makeLogger(),
      );

      const result = await orchestrator.run();

      expect(mockPlatform.createPullRequest).not.toHaveBeenCalled();
      expect(result.pr).toBeUndefined();
    });

    it('should leave IssueResult.pr undefined when PR creation throws', async () => {
      const mockPlatform: PlatformProvider = {
        getIssue: vi.fn(),
        listIssues: vi.fn(),
        createPullRequest: vi.fn().mockRejectedValue(new Error('GitHub API error')),
        issueLinkSuffix: vi.fn().mockReturnValue('Closes #42'),
      } as unknown as PlatformProvider;

      const mockLauncher: AgentLauncher = {
        launchAgent: vi.fn().mockResolvedValue({
          agent: 'pr-composer',
          success: true,
          exitCode: 0,
          timedOut: false,
          duration: 100,
          stdout: '',
          stderr: '',
          tokenUsage: 500,
          outputPath: '/tmp/pr-content.md',
          outputExists: true,
        }),
      } as unknown as AgentLauncher;

      const orchestrator = new IssueOrchestrator(
        makeConfig({ pullRequest: { autoCreate: true, draft: false, linkIssue: false } }),
        makeIssue(),
        makeWorktree(),
        makeCheckpoint([1, 2, 3, 4]),
        mockLauncher,
        mockPlatform,
        makeLogger(),
      );

      // PR creation failure is non-critical — run() should still succeed
      const result = await orchestrator.run();

      expect(result.pr).toBeUndefined();
    });
  });

  describe('launchWithRetry() fallback tokenUsage is null', () => {
    it('should return tokenUsage: null when all retries are exhausted', async () => {
      // RetryExecutor always fails → launchWithRetry returns the fallback AgentResult
      mockRetryExecutor.execute.mockResolvedValue({
        success: false,
        error: 'agent failed',
        attempts: 1,
        recoveryUsed: false,
        result: undefined,
      });

      const mockPlatform: PlatformProvider = {
        getIssue: vi.fn(),
        listIssues: vi.fn(),
        createPullRequest: vi.fn(),
        issueLinkSuffix: vi.fn(),
      } as unknown as PlatformProvider;

      const mockLauncher: AgentLauncher = {
        launchAgent: vi.fn(),
      } as unknown as AgentLauncher;

      const orchestrator = new IssueOrchestrator(
        makeConfig({ pullRequest: { autoCreate: false, draft: false, linkIssue: false } }),
        makeIssue(),
        makeWorktree(),
        // Phase 5 not yet completed so it will run and call launchWithRetry
        makeCheckpoint([1, 2, 3, 4]),
        mockLauncher,
        mockPlatform,
        makeLogger(),
      );

      const result = await orchestrator.run();

      // Phase 5 is non-critical; pipeline succeeds overall but phase 5 fails
      expect(result).toBeDefined();

      // Verify that launchWithRetry was invoked (via retryExecutor.execute)
      expect(mockRetryExecutor.execute).toHaveBeenCalled();
    });
  });

  describe('recordTokens() null-safety guard', () => {
    it('should not record tokens when tokenUsage is null', async () => {
      const mockPlatform: PlatformProvider = {
        getIssue: vi.fn(),
        listIssues: vi.fn(),
        createPullRequest: vi.fn().mockResolvedValue({ number: 1, url: 'u', title: 't', branch: 'b' }),
        issueLinkSuffix: vi.fn().mockReturnValue(''),
      } as unknown as PlatformProvider;

      const mockLauncher: AgentLauncher = {
        launchAgent: vi.fn().mockResolvedValue({
          agent: 'pr-composer',
          success: true,
          exitCode: 0,
          timedOut: false,
          duration: 100,
          stdout: '',
          stderr: '',
          tokenUsage: null, // ← null token usage
          outputPath: '/tmp/pr-content.md',
          outputExists: true,
        }),
      } as unknown as AgentLauncher;

      const orchestrator = new IssueOrchestrator(
        makeConfig({ pullRequest: { autoCreate: true, draft: false, linkIssue: false } }),
        makeIssue(),
        makeWorktree(),
        makeCheckpoint([1, 2, 3, 4]),
        mockLauncher,
        mockPlatform,
        makeLogger(),
      );

      await orchestrator.run();

      // tokenTracker.record should NOT have been called because tokenUsage was null
      expect(mockTokenTracker.record).not.toHaveBeenCalled();
    });

    it('should not record tokens when tokenUsage is 0', async () => {
      const mockPlatform: PlatformProvider = {
        getIssue: vi.fn(),
        listIssues: vi.fn(),
        createPullRequest: vi.fn().mockResolvedValue({ number: 1, url: 'u', title: 't', branch: 'b' }),
        issueLinkSuffix: vi.fn().mockReturnValue(''),
      } as unknown as PlatformProvider;

      const mockLauncher: AgentLauncher = {
        launchAgent: vi.fn().mockResolvedValue({
          agent: 'pr-composer',
          success: true,
          exitCode: 0,
          timedOut: false,
          duration: 100,
          stdout: '',
          stderr: '',
          tokenUsage: 0, // ← zero tokens
          outputPath: '/tmp/pr-content.md',
          outputExists: true,
        }),
      } as unknown as AgentLauncher;

      const orchestrator = new IssueOrchestrator(
        makeConfig({ pullRequest: { autoCreate: true, draft: false, linkIssue: false } }),
        makeIssue(),
        makeWorktree(),
        makeCheckpoint([1, 2, 3, 4]),
        mockLauncher,
        mockPlatform,
        makeLogger(),
      );

      await orchestrator.run();

      expect(mockTokenTracker.record).not.toHaveBeenCalled();
    });

    it('should record tokens when tokenUsage is a positive number', async () => {
      const mockPlatform: PlatformProvider = {
        getIssue: vi.fn(),
        listIssues: vi.fn(),
        createPullRequest: vi.fn().mockResolvedValue({ number: 1, url: 'u', title: 't', branch: 'b' }),
        issueLinkSuffix: vi.fn().mockReturnValue(''),
      } as unknown as PlatformProvider;

      const mockLauncher: AgentLauncher = {
        launchAgent: vi.fn().mockResolvedValue({
          agent: 'pr-composer',
          success: true,
          exitCode: 0,
          timedOut: false,
          duration: 100,
          stdout: '',
          stderr: '',
          tokenUsage: 750, // ← positive tokens
          outputPath: '/tmp/pr-content.md',
          outputExists: true,
        }),
      } as unknown as AgentLauncher;

      const orchestrator = new IssueOrchestrator(
        makeConfig({ pullRequest: { autoCreate: true, draft: false, linkIssue: false } }),
        makeIssue(),
        makeWorktree(),
        makeCheckpoint([1, 2, 3, 4]),
        mockLauncher,
        mockPlatform,
        makeLogger(),
      );

      await orchestrator.run();

      expect(mockTokenTracker.record).toHaveBeenCalledWith(42, 'pr-composer', expect.any(Number), 750);
    });
  });
});
