import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ReviewResponseOrchestrator, REVIEW_RESPONSE_PHASES } from '../src/core/review-response-orchestrator.js';
import { makeRuntimeConfig } from './helpers/make-runtime-config.js';
import type { RuntimeConfig } from '../src/config/loader.js';
import type { PullRequestInfo, ReviewThread } from '../src/platform/provider.js';

// Mock heavy I/O dependencies
vi.mock('node:fs/promises', () => ({
  mkdir: vi.fn().mockResolvedValue(undefined),
  writeFile: vi.fn().mockResolvedValue(undefined),
  readFile: vi.fn().mockResolvedValue('# PR Content\n\nSome body'),
}));

vi.mock('../src/git/commit.js', () => ({
  CommitManager: vi.fn().mockImplementation(() => ({
    push: vi.fn().mockResolvedValue(undefined),
  })),
}));

vi.mock('../src/agents/result-parser.js', () => ({
  ResultParser: vi.fn().mockImplementation(() => ({
    parsePRContent: vi.fn().mockResolvedValue({ title: 'Updated PR Title', body: 'Updated body addressing review comments' }),
  })),
}));

vi.mock('../src/core/checkpoint.js', () => ({
  CheckpointManager: vi.fn().mockImplementation(() => ({
    load: vi.fn().mockResolvedValue(undefined),
    resetPhases: vi.fn().mockResolvedValue(undefined),
    completePhase: vi.fn().mockResolvedValue(undefined),
    setWorktreeInfo: vi.fn().mockResolvedValue(undefined),
  })),
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

vi.mock('../src/agents/context-builder.js', () => ({
  ContextBuilder: vi.fn().mockImplementation(() => ({
    buildForReviewResponse: vi.fn().mockReturnValue('# Review context'),
    buildForConflictResolver: vi.fn().mockResolvedValue('/tmp/worktree/1/.cadre/issues/1/contexts/conflict-resolver-123.json'),
  })),
}));

vi.mock('../src/logging/logger.js', () => ({
  Logger: vi.fn(),
}));

vi.mock('../src/notifications/manager.js', () => ({
  NotificationManager: vi.fn().mockImplementation(() => ({
    dispatch: vi.fn().mockResolvedValue(undefined),
  })),
}));

function makeConfig(reviewResponseOverrides: Partial<RuntimeConfig['reviewResponse']> = {}) {
  return makeRuntimeConfig({
    stateDir: '/tmp/cadre-state',
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
    },
    reviewResponse: { autoReplyOnResolved: false, ...reviewResponseOverrides },
  });
}

function makePR(overrides: Partial<PullRequestInfo> = {}): PullRequestInfo {
  return {
    number: 10,
    url: 'https://github.com/owner/repo/pull/10',
    title: 'Test PR',
    headBranch: 'cadre/issue-1',
    baseBranch: 'main',
    ...overrides,
  };
}

function makeThread(overrides: Partial<ReviewThread> = {}): ReviewThread {
  return {
    id: 'thread-1',
    prNumber: 10,
    isResolved: false,
    isOutdated: false,
    comments: [],
    ...overrides,
  };
}

function makeMockDeps() {
  const worktreeManager = {
    provisionFromBranch: vi.fn().mockResolvedValue({
      path: '/tmp/worktree/1',
      branch: 'cadre/issue-1',
      baseCommit: 'abc123',
    }),
    rebaseStart: vi.fn().mockResolvedValue({ status: 'clean' }),
    rebaseContinue: vi.fn().mockResolvedValue({ success: true }),
    rebaseAbort: vi.fn().mockResolvedValue(undefined),
  };
  const launcher = {};
  const platform = {
    listPullRequests: vi.fn().mockResolvedValue([]),
    listPRReviewComments: vi.fn().mockResolvedValue([]),
    listPRComments: vi.fn().mockResolvedValue([]),
    listPRReviews: vi.fn().mockResolvedValue([]),
    getIssue: vi.fn().mockResolvedValue({
      number: 1,
      title: 'Issue 1',
      body: '',
      labels: [],
      state: 'open',
      url: 'https://github.com/owner/repo/issues/1',
      author: 'user',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      comments: [],
    }),
    addIssueComment: vi.fn().mockResolvedValue(undefined),
    updatePullRequest: vi.fn().mockResolvedValue(undefined),
    issueLinkSuffix: vi.fn().mockReturnValue('Closes #1'),
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

describe('ReviewResponseOrchestrator — REVIEW_RESPONSE_PHASES constant', () => {
  it('exports REVIEW_RESPONSE_PHASES as [3, 4, 5]', () => {
    expect(REVIEW_RESPONSE_PHASES).toEqual([3, 4, 5]);
  });
});

describe('ReviewResponseOrchestrator — run() skipping logic', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('skips issues with no open PR and increments skipped count', async () => {
    const config = makeConfig();
    const { worktreeManager, launcher, platform, logger } = makeMockDeps();
    platform.listPullRequests.mockResolvedValue([]); // no open PRs

    const orchestrator = new ReviewResponseOrchestrator(
      config,
      worktreeManager as any,
      launcher as any,
      platform as any,
      logger as any,
    );

    const result = await orchestrator.run([1]);

    expect(result.skipped).toBe(1);
    expect(result.processed).toBe(0);
    expect(result.issues[0]).toMatchObject({
      issueNumber: 1,
      skipped: true,
      skipReason: 'no open PR',
    });
  });

  it('logs an info message when an issue has no open PR', async () => {
    const config = makeConfig();
    const { worktreeManager, launcher, platform, logger } = makeMockDeps();
    platform.listPullRequests.mockResolvedValue([]);

    const orchestrator = new ReviewResponseOrchestrator(
      config,
      worktreeManager as any,
      launcher as any,
      platform as any,
      logger as any,
    );

    await orchestrator.run([42]);

    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining('42'),
      expect.objectContaining({ issueNumber: 42 }),
    );
  });

  it('skips issues where all review threads are resolved', async () => {
    const config = makeConfig();
    const { worktreeManager, launcher, platform, logger } = makeMockDeps();
    platform.listPullRequests.mockResolvedValue([makePR()]);
    platform.listPRReviewComments.mockResolvedValue([
      makeThread({ isResolved: true }),
      makeThread({ id: 'thread-2', isResolved: true }),
    ]);

    const orchestrator = new ReviewResponseOrchestrator(
      config,
      worktreeManager as any,
      launcher as any,
      platform as any,
      logger as any,
    );

    const result = await orchestrator.run([1]);

    expect(result.skipped).toBe(1);
    expect(result.processed).toBe(0);
    expect(result.issues[0]).toMatchObject({
      issueNumber: 1,
      skipped: true,
      skipReason: 'no unresolved review threads or PR comments',
    });
  });

  it('skips issues where all review threads are outdated', async () => {
    const config = makeConfig();
    const { worktreeManager, launcher, platform, logger } = makeMockDeps();
    platform.listPullRequests.mockResolvedValue([makePR()]);
    platform.listPRReviewComments.mockResolvedValue([
      makeThread({ isOutdated: true }),
    ]);

    const orchestrator = new ReviewResponseOrchestrator(
      config,
      worktreeManager as any,
      launcher as any,
      platform as any,
      logger as any,
    );

    const result = await orchestrator.run([1]);

    expect(result.skipped).toBe(1);
    expect(result.processed).toBe(0);
    expect(result.issues[0]).toMatchObject({
      issueNumber: 1,
      skipped: true,
      skipReason: 'no unresolved review threads or PR comments',
    });
  });

  it('does not skip issues with at least one active (unresolved, non-outdated) thread', async () => {
    const config = makeConfig();
    const { worktreeManager, launcher, platform, logger } = makeMockDeps();
    platform.listPullRequests.mockResolvedValue([makePR()]);
    platform.listPRReviewComments.mockResolvedValue([
      makeThread({ isResolved: true }),
      makeThread({ id: 'thread-active', isResolved: false, isOutdated: false }),
    ]);

    const orchestrator = new ReviewResponseOrchestrator(
      config,
      worktreeManager as any,
      launcher as any,
      platform as any,
      logger as any,
    );

    const result = await orchestrator.run([1]);

    expect(result.processed).toBe(1);
    expect(result.skipped).toBe(0);
  });
});

describe('ReviewResponseOrchestrator — run() rebase step', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('calls worktreeManager.rebaseStart after provisioning the worktree', async () => {
    const config = makeConfig();
    const { worktreeManager, launcher, platform, logger } = makeMockDeps();
    platform.listPullRequests.mockResolvedValue([makePR()]);
    platform.listPRReviewComments.mockResolvedValue([makeThread()]);

    const orchestrator = new ReviewResponseOrchestrator(
      config,
      worktreeManager as any,
      launcher as any,
      platform as any,
      logger as any,
    );

    await orchestrator.run([1]);

    expect(worktreeManager.rebaseStart).toHaveBeenCalledWith(1);
  });

  it('proceeds with the pipeline when rebase has no conflicts', async () => {
    const config = makeConfig();
    const { worktreeManager, launcher, platform, logger } = makeMockDeps();
    platform.listPullRequests.mockResolvedValue([makePR()]);
    platform.listPRReviewComments.mockResolvedValue([makeThread()]);
    worktreeManager.rebaseStart.mockResolvedValue({ status: 'clean' });

    const orchestrator = new ReviewResponseOrchestrator(
      config,
      worktreeManager as any,
      launcher as any,
      platform as any,
      logger as any,
    );

    const result = await orchestrator.run([1]);

    expect(result.processed).toBe(1);
    expect(result.succeeded).toBe(1);
  });

  it('launches the conflict-resolver agent when rebaseStart reports conflicts', async () => {
    const config = makeConfig();
    const { worktreeManager, launcher, platform, logger } = makeMockDeps();
    platform.listPullRequests.mockResolvedValue([makePR()]);
    platform.listPRReviewComments.mockResolvedValue([makeThread()]);
    worktreeManager.rebaseStart.mockResolvedValue({
      status: 'conflict',
      conflictedFiles: ['src/foo.ts'],
      worktreePath: '/tmp/worktree/1',
    });

    // Provide a minimal launcher mock that records calls
    const launchAgent = vi.fn().mockResolvedValue({
      agent: 'conflict-resolver',
      success: true,
      exitCode: 0,
      timedOut: false,
      duration: 100,
      outputExists: true,
      stdout: '',
      stderr: '',
    });
    (launcher as any).launchAgent = launchAgent;

    const orchestrator = new ReviewResponseOrchestrator(
      config,
      worktreeManager as any,
      launcher as any,
      platform as any,
      logger as any,
    );

    await orchestrator.run([1]);

    expect(launchAgent).toHaveBeenCalledWith(
      expect.objectContaining({ agent: 'conflict-resolver', issueNumber: 1 }),
      '/tmp/worktree/1',
    );
  });

  it('calls rebaseContinue after the conflict-resolver agent succeeds', async () => {
    const config = makeConfig();
    const { worktreeManager, launcher, platform, logger } = makeMockDeps();
    platform.listPullRequests.mockResolvedValue([makePR()]);
    platform.listPRReviewComments.mockResolvedValue([makeThread()]);
    worktreeManager.rebaseStart.mockResolvedValue({
      status: 'conflict',
      conflictedFiles: ['src/foo.ts'],
      worktreePath: '/tmp/worktree/1',
    });
    (launcher as any).launchAgent = vi.fn().mockResolvedValue({ success: true, exitCode: 0, timedOut: false, duration: 100, agent: 'conflict-resolver', outputExists: true, stdout: '', stderr: '' });

    const orchestrator = new ReviewResponseOrchestrator(
      config,
      worktreeManager as any,
      launcher as any,
      platform as any,
      logger as any,
    );

    await orchestrator.run([1]);

    expect(worktreeManager.rebaseContinue).toHaveBeenCalledWith(1);
  });

  it('aborts the rebase and fails the issue when the conflict-resolver agent fails', async () => {
    const config = makeConfig();
    const { worktreeManager, launcher, platform, logger } = makeMockDeps();
    platform.listPullRequests.mockResolvedValue([makePR()]);
    platform.listPRReviewComments.mockResolvedValue([makeThread()]);
    worktreeManager.rebaseStart.mockResolvedValue({
      status: 'conflict',
      conflictedFiles: ['src/foo.ts'],
      worktreePath: '/tmp/worktree/1',
    });
    (launcher as any).launchAgent = vi.fn().mockResolvedValue({ success: false, exitCode: 1, timedOut: false, duration: 100, agent: 'conflict-resolver', outputExists: false, stdout: '', stderr: 'build error' });

    const orchestrator = new ReviewResponseOrchestrator(
      config,
      worktreeManager as any,
      launcher as any,
      platform as any,
      logger as any,
    );

    const result = await orchestrator.run([1]);

    expect(worktreeManager.rebaseAbort).toHaveBeenCalledWith(1);
    expect(result.failed).toBe(1);
    expect(result.processed).toBe(0);
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining('exit 1'),
      expect.objectContaining({ issueNumber: 1 }),
    );
  });

  it('aborts the rebase and fails the issue when conflict-resolver agent times out', async () => {
    const config = makeConfig();
    const { worktreeManager, launcher, platform, logger } = makeMockDeps();
    platform.listPullRequests.mockResolvedValue([makePR()]);
    platform.listPRReviewComments.mockResolvedValue([makeThread()]);
    worktreeManager.rebaseStart.mockResolvedValue({
      status: 'conflict',
      conflictedFiles: ['src/foo.ts'],
      worktreePath: '/tmp/worktree/1',
    });
    (launcher as any).launchAgent = vi.fn().mockResolvedValue({ success: false, exitCode: null, timedOut: true, duration: 300000, agent: 'conflict-resolver', outputExists: false, stdout: '', stderr: '' });

    const orchestrator = new ReviewResponseOrchestrator(
      config,
      worktreeManager as any,
      launcher as any,
      platform as any,
      logger as any,
    );

    const result = await orchestrator.run([1]);

    expect(worktreeManager.rebaseAbort).toHaveBeenCalledWith(1);
    expect(result.failed).toBe(1);
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining('timed out after 300000ms'),
      expect.objectContaining({ issueNumber: 1 }),
    );
  });

  it('aborts the rebase and fails the issue when conflict-resolver exits 0 but produces no output', async () => {
    const config = makeConfig();
    const { worktreeManager, launcher, platform, logger } = makeMockDeps();
    platform.listPullRequests.mockResolvedValue([makePR()]);
    platform.listPRReviewComments.mockResolvedValue([makeThread()]);
    worktreeManager.rebaseStart.mockResolvedValue({
      status: 'conflict',
      conflictedFiles: ['src/foo.ts'],
      worktreePath: '/tmp/worktree/1',
    });
    (launcher as any).launchAgent = vi.fn().mockResolvedValue({
      success: true,
      exitCode: 0,
      timedOut: false,
      duration: 100,
      agent: 'conflict-resolver',
      outputExists: false,
      outputPath: '/tmp/issues/1/conflict-resolution-report.md',
      stdout: '',
      stderr: '',
    });

    const orchestrator = new ReviewResponseOrchestrator(
      config,
      worktreeManager as any,
      launcher as any,
      platform as any,
      logger as any,
    );

    const result = await orchestrator.run([1]);

    expect(worktreeManager.rebaseAbort).toHaveBeenCalledWith(1);
    expect(result.failed).toBe(1);
    expect(result.processed).toBe(0);
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining('produced no output'),
      expect.objectContaining({ issueNumber: 1 }),
    );
  });

  it('aborts the rebase and fails the issue when rebaseContinue fails', async () => {
    const config = makeConfig();
    const { worktreeManager, launcher, platform, logger } = makeMockDeps();
    platform.listPullRequests.mockResolvedValue([makePR()]);
    platform.listPRReviewComments.mockResolvedValue([makeThread()]);
    worktreeManager.rebaseStart.mockResolvedValue({
      status: 'conflict',
      conflictedFiles: ['src/foo.ts'],
      worktreePath: '/tmp/worktree/1',
    });
    (launcher as any).launchAgent = vi.fn().mockResolvedValue({ success: true, exitCode: 0, timedOut: false, duration: 100, agent: 'conflict-resolver', outputExists: true, stdout: '', stderr: '' });
    worktreeManager.rebaseContinue.mockResolvedValue({ success: false, error: 'Conflicts remain after resolution attempt: src/foo.ts', conflictedFiles: ['src/foo.ts'] });

    const orchestrator = new ReviewResponseOrchestrator(
      config,
      worktreeManager as any,
      launcher as any,
      platform as any,
      logger as any,
    );

    const result = await orchestrator.run([1]);

    expect(worktreeManager.rebaseAbort).toHaveBeenCalledWith(1);
    expect(result.failed).toBe(1);
    expect(result.processed).toBe(0);
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining('Rebase --continue failed'),
      expect.objectContaining({ issueNumber: 1, data: expect.objectContaining({ conflictedFiles: ['src/foo.ts'] }) }),
    );
  });

  it('proceeds with the pipeline after successful conflict resolution', async () => {
    const config = makeConfig();
    const { worktreeManager, launcher, platform, logger } = makeMockDeps();
    platform.listPullRequests.mockResolvedValue([makePR()]);
    platform.listPRReviewComments.mockResolvedValue([makeThread()]);
    worktreeManager.rebaseStart.mockResolvedValue({
      status: 'conflict',
      conflictedFiles: ['src/foo.ts'],
      worktreePath: '/tmp/worktree/1',
    });
    (launcher as any).launchAgent = vi.fn().mockResolvedValue({ success: true, exitCode: 0, timedOut: false, duration: 100, agent: 'conflict-resolver', outputExists: true, stdout: '', stderr: '' });
    worktreeManager.rebaseContinue.mockResolvedValue({ success: true });

    const orchestrator = new ReviewResponseOrchestrator(
      config,
      worktreeManager as any,
      launcher as any,
      platform as any,
      logger as any,
    );

    const result = await orchestrator.run([1]);

    expect(result.processed).toBe(1);
    expect(result.succeeded).toBe(1);
  });

  it('force-pushes after a successful rebase and pipeline', async () => {
    const { CommitManager } = await import('../src/git/commit.js');
    const pushMock = vi.fn().mockResolvedValue(undefined);
    (CommitManager as ReturnType<typeof vi.fn>).mockImplementationOnce(() => ({ push: pushMock }));

    const config = makeConfig();
    const { worktreeManager, launcher, platform, logger } = makeMockDeps();
    platform.listPullRequests.mockResolvedValue([makePR()]);
    platform.listPRReviewComments.mockResolvedValue([makeThread()]);
    worktreeManager.rebaseStart.mockResolvedValue({ status: 'clean' });

    const orchestrator = new ReviewResponseOrchestrator(
      config,
      worktreeManager as any,
      launcher as any,
      platform as any,
      logger as any,
    );

    await orchestrator.run([1]);

    expect(pushMock).toHaveBeenCalledWith(true, 'cadre/issue-1');
  });
});

describe('ReviewResponseOrchestrator — run() pipeline execution', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns correct counts when pipeline succeeds', async () => {
    const config = makeConfig();
    const { worktreeManager, launcher, platform, logger } = makeMockDeps();
    platform.listPullRequests.mockResolvedValue([makePR()]);
    platform.listPRReviewComments.mockResolvedValue([makeThread()]);

    const orchestrator = new ReviewResponseOrchestrator(
      config,
      worktreeManager as any,
      launcher as any,
      platform as any,
      logger as any,
    );

    const result = await orchestrator.run([1]);

    expect(result.processed).toBe(1);
    expect(result.succeeded).toBe(1);
    expect(result.failed).toBe(0);
    expect(result.skipped).toBe(0);
  });

  it('calls worktreeManager.provisionFromBranch with the PR head branch', async () => {
    const config = makeConfig();
    const { worktreeManager, launcher, platform, logger } = makeMockDeps();
    platform.listPullRequests.mockResolvedValue([makePR({ headBranch: 'cadre/issue-1' })]);
    platform.listPRReviewComments.mockResolvedValue([makeThread()]);

    const orchestrator = new ReviewResponseOrchestrator(
      config,
      worktreeManager as any,
      launcher as any,
      platform as any,
      logger as any,
    );

    await orchestrator.run([1]);

    expect(worktreeManager.provisionFromBranch).toHaveBeenCalledWith(1, 'cadre/issue-1');
  });

  it('does not post a reply comment when autoReplyOnResolved is false', async () => {
    const config = makeConfig({ autoReplyOnResolved: false });
    const { worktreeManager, launcher, platform, logger } = makeMockDeps();
    platform.listPullRequests.mockResolvedValue([makePR()]);
    platform.listPRReviewComments.mockResolvedValue([makeThread()]);

    const orchestrator = new ReviewResponseOrchestrator(
      config,
      worktreeManager as any,
      launcher as any,
      platform as any,
      logger as any,
    );

    await orchestrator.run([1]);

    expect(platform.addIssueComment).not.toHaveBeenCalled();
  });

  it('posts a reply comment when autoReplyOnResolved is true and pipeline succeeds', async () => {
    const config = makeConfig({ autoReplyOnResolved: true });
    const { worktreeManager, launcher, platform, logger } = makeMockDeps();
    platform.listPullRequests.mockResolvedValue([makePR({ number: 10 })]);
    platform.listPRReviewComments.mockResolvedValue([makeThread()]);

    const orchestrator = new ReviewResponseOrchestrator(
      config,
      worktreeManager as any,
      launcher as any,
      platform as any,
      logger as any,
    );

    await orchestrator.run([1]);

    expect(platform.addIssueComment).toHaveBeenCalledWith(
      1,
      expect.stringContaining('PR #10'),
    );
  });

  it('pushes the branch after a successful pipeline', async () => {
    const { CommitManager } = await import('../src/git/commit.js');
    const pushSpy = vi.fn().mockResolvedValue(undefined);
    (CommitManager as ReturnType<typeof vi.fn>).mockImplementationOnce(() => ({ push: pushSpy }));

    const config = makeConfig();
    const { worktreeManager, launcher, platform, logger } = makeMockDeps();
    platform.listPullRequests.mockResolvedValue([makePR()]);
    platform.listPRReviewComments.mockResolvedValue([makeThread()]);

    const orchestrator = new ReviewResponseOrchestrator(
      config,
      worktreeManager as any,
      launcher as any,
      platform as any,
      logger as any,
    );

    await orchestrator.run([1]);

    expect(pushSpy).toHaveBeenCalledOnce();
  });

  it('updates the existing PR description after a successful pipeline', async () => {
    const config = makeConfig();
    const { worktreeManager, launcher, platform, logger } = makeMockDeps();
    platform.listPullRequests.mockResolvedValue([makePR({ number: 10 })]);
    platform.listPRReviewComments.mockResolvedValue([makeThread()]);

    const orchestrator = new ReviewResponseOrchestrator(
      config,
      worktreeManager as any,
      launcher as any,
      platform as any,
      logger as any,
    );

    await orchestrator.run([1]);

    expect(platform.updatePullRequest).toHaveBeenCalledWith(
      10,
      expect.objectContaining({ body: expect.any(String) }),
    );
  });

  it('does not push or update PR when pipeline fails', async () => {
    const { IssueOrchestrator } = await import('../src/core/issue-orchestrator.js');
    (IssueOrchestrator as ReturnType<typeof vi.fn>).mockImplementationOnce(() => ({
      run: vi.fn().mockResolvedValue({ issueNumber: 1, success: false, phases: [], totalDuration: 0, tokenUsage: 0 }),
    }));

    const { CommitManager } = await import('../src/git/commit.js');

    const config = makeConfig();
    const { worktreeManager, launcher, platform, logger } = makeMockDeps();
    platform.listPullRequests.mockResolvedValue([makePR()]);
    platform.listPRReviewComments.mockResolvedValue([makeThread()]);

    const orchestrator = new ReviewResponseOrchestrator(
      config,
      worktreeManager as any,
      launcher as any,
      platform as any,
      logger as any,
    );

    await orchestrator.run([1]);

    expect(CommitManager).not.toHaveBeenCalled();
    expect(platform.updatePullRequest).not.toHaveBeenCalled();
  });

  it('does not post a reply comment when autoReplyOnResolved is true but pipeline fails', async () => {
    const { IssueOrchestrator } = await import('../src/core/issue-orchestrator.js');
    (IssueOrchestrator as ReturnType<typeof vi.fn>).mockImplementationOnce(() => ({
      run: vi.fn().mockResolvedValue({ issueNumber: 1, success: false, phases: [], totalDuration: 0, tokenUsage: 0 }),
    }));

    const config = makeConfig({ autoReplyOnResolved: true });
    const { worktreeManager, launcher, platform, logger } = makeMockDeps();
    platform.listPullRequests.mockResolvedValue([makePR()]);
    platform.listPRReviewComments.mockResolvedValue([makeThread()]);

    const orchestrator = new ReviewResponseOrchestrator(
      config,
      worktreeManager as any,
      launcher as any,
      platform as any,
      logger as any,
    );

    await orchestrator.run([1]);

    expect(platform.addIssueComment).not.toHaveBeenCalled();
  });

  it('counts the issue as failed and logs when push throws', async () => {
    const { CommitManager } = await import('../src/git/commit.js');
    (CommitManager as ReturnType<typeof vi.fn>).mockImplementationOnce(() => ({
      push: vi.fn().mockRejectedValue(new Error('push error')),
    }));

    const config = makeConfig();
    const { worktreeManager, launcher, platform, logger } = makeMockDeps();
    platform.listPullRequests.mockResolvedValue([makePR()]);
    platform.listPRReviewComments.mockResolvedValue([makeThread()]);

    const orchestrator = new ReviewResponseOrchestrator(
      config,
      worktreeManager as any,
      launcher as any,
      platform as any,
      logger as any,
    );

    const result = await orchestrator.run([1]);

    expect(result.failed).toBe(1);
    expect(result.succeeded).toBe(0);
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining('push error'),
      expect.objectContaining({ issueNumber: 1 }),
    );
  });

  it('counts the issue as failed and logs when updatePullRequest throws', async () => {
    const { CommitManager } = await import('../src/git/commit.js');
    (CommitManager as ReturnType<typeof vi.fn>).mockImplementationOnce(() => ({
      push: vi.fn().mockResolvedValue(undefined),
    }));

    const config = makeConfig();
    const { worktreeManager, launcher, platform, logger } = makeMockDeps();
    platform.listPullRequests.mockResolvedValue([makePR({ number: 10 })]);
    platform.listPRReviewComments.mockResolvedValue([makeThread()]);
    platform.updatePullRequest.mockRejectedValue(new Error('update error'));

    const orchestrator = new ReviewResponseOrchestrator(
      config,
      worktreeManager as any,
      launcher as any,
      platform as any,
      logger as any,
    );

    const result = await orchestrator.run([1]);

    expect(result.failed).toBe(1);
    expect(result.succeeded).toBe(0);
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining('update error'),
      expect.objectContaining({ issueNumber: 1 }),
    );
  });

  it('increments failed count and logs error when pipeline throws', async () => {
    const { IssueOrchestrator } = await import('../src/core/issue-orchestrator.js');
    (IssueOrchestrator as ReturnType<typeof vi.fn>).mockImplementationOnce(() => ({
      run: vi.fn().mockRejectedValue(new Error('pipeline error')),
    }));

    const config = makeConfig();
    const { worktreeManager, launcher, platform, logger } = makeMockDeps();
    platform.listPullRequests.mockResolvedValue([makePR()]);
    platform.listPRReviewComments.mockResolvedValue([makeThread()]);

    const orchestrator = new ReviewResponseOrchestrator(
      config,
      worktreeManager as any,
      launcher as any,
      platform as any,
      logger as any,
    );

    const result = await orchestrator.run([1]);

    expect(result.failed).toBe(1);
    expect(result.succeeded).toBe(0);
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining('pipeline error'),
      expect.objectContaining({ issueNumber: 1 }),
    );
  });

  it('returns ReviewResponseResult with correct shape', async () => {
    const config = makeConfig();
    const { worktreeManager, launcher, platform, logger } = makeMockDeps();
    platform.listPullRequests.mockResolvedValue([]);

    const orchestrator = new ReviewResponseOrchestrator(
      config,
      worktreeManager as any,
      launcher as any,
      platform as any,
      logger as any,
    );

    const result = await orchestrator.run([]);

    expect(result).toMatchObject({
      processed: expect.any(Number),
      skipped: expect.any(Number),
      succeeded: expect.any(Number),
      failed: expect.any(Number),
      issues: expect.any(Array),
    });
  });
});

describe('ReviewResponseOrchestrator — run() without issueNumbers', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('processes all issues derived from open PRs when no issueNumbers are provided', async () => {
    const config = makeConfig();
    const { worktreeManager, launcher, platform, logger } = makeMockDeps();
    platform.listPullRequests.mockResolvedValue([
      makePR({ number: 10, headBranch: 'cadre/issue-1' }),
      makePR({ number: 11, headBranch: 'cadre/issue-2' }),
    ]);
    platform.listPRReviewComments.mockResolvedValue([makeThread()]);
    platform.getIssue.mockImplementation(async (num: number) => ({
      number: num,
      title: `Issue ${num}`,
      body: '',
      labels: [],
      state: 'open',
      url: `https://github.com/owner/repo/issues/${num}`,
      author: 'user',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      comments: [],
    }));

    const orchestrator = new ReviewResponseOrchestrator(
      config,
      worktreeManager as any,
      launcher as any,
      platform as any,
      logger as any,
    );

    const result = await orchestrator.run(); // no issueNumbers

    expect(result.processed).toBe(2);
    expect(result.issues).toHaveLength(2);
  });

  it('returns empty results when there are no open PRs and no issueNumbers given', async () => {
    const config = makeConfig();
    const { worktreeManager, launcher, platform, logger } = makeMockDeps();
    platform.listPullRequests.mockResolvedValue([]);

    const orchestrator = new ReviewResponseOrchestrator(
      config,
      worktreeManager as any,
      launcher as any,
      platform as any,
      logger as any,
    );

    const result = await orchestrator.run();

    expect(result.processed).toBe(0);
    expect(result.skipped).toBe(0);
    expect(result.issues).toHaveLength(0);
  });
});

describe('ReviewResponseOrchestrator — mapIssuesToPRs (via run)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('matches PRs to issues using the branch template', async () => {
    const config = makeConfig();
    const { worktreeManager, launcher, platform, logger } = makeMockDeps();
    platform.listPullRequests.mockResolvedValue([
      makePR({ number: 55, headBranch: 'cadre/issue-99' }),
    ]);
    platform.listPRReviewComments.mockResolvedValue([makeThread()]);
    platform.getIssue.mockResolvedValue({
      number: 99,
      title: 'Issue 99',
      body: '',
      labels: [],
      state: 'open',
      url: '',
      author: 'user',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      comments: [],
    });

    const orchestrator = new ReviewResponseOrchestrator(
      config,
      worktreeManager as any,
      launcher as any,
      platform as any,
      logger as any,
    );

    const result = await orchestrator.run([99]);

    expect(result.processed).toBe(1);
    expect(worktreeManager.provisionFromBranch).toHaveBeenCalledWith(99, 'cadre/issue-99');
  });

  it('skips PRs whose branch names do not match the template', async () => {
    const config = makeConfig();
    const { worktreeManager, launcher, platform, logger } = makeMockDeps();
    platform.listPullRequests.mockResolvedValue([
      makePR({ number: 77, headBranch: 'feature/unrelated-branch' }),
    ]);
    platform.listPRReviewComments.mockResolvedValue([makeThread()]);

    const orchestrator = new ReviewResponseOrchestrator(
      config,
      worktreeManager as any,
      launcher as any,
      platform as any,
      logger as any,
    );

    // issue 1 has no matching PR (the only PR has a non-matching branch)
    const result = await orchestrator.run([1]);

    expect(result.skipped).toBe(1);
    expect(result.issues[0].skipReason).toBe('no open PR');
  });

  it('keeps the first PR found when multiple PRs map to the same issue number', async () => {
    const config = makeConfig();
    const { worktreeManager, launcher, platform, logger } = makeMockDeps();
    platform.listPullRequests.mockResolvedValue([
      makePR({ number: 10, headBranch: 'cadre/issue-1' }),
      makePR({ number: 20, headBranch: 'cadre/issue-1' }), // duplicate mapping
    ]);
    platform.listPRReviewComments.mockResolvedValue([makeThread()]);

    const orchestrator = new ReviewResponseOrchestrator(
      config,
      worktreeManager as any,
      launcher as any,
      platform as any,
      logger as any,
    );

    await orchestrator.run([1]);

    // Should use PR #10 (the first one) — provisionFromBranch uses headBranch of PR #10
    expect(worktreeManager.provisionFromBranch).toHaveBeenCalledTimes(1);
    expect(worktreeManager.provisionFromBranch).toHaveBeenCalledWith(1, 'cadre/issue-1');
  });
});
