import { describe, it, expect, vi, beforeEach } from 'vitest';
import { IssueOrchestrator } from '../src/core/issue-orchestrator.js';
import type { CadreConfig } from '../src/config/schema.js';
import type { CheckpointManager } from '../src/core/checkpoint.js';
import type { AgentLauncher } from '../src/core/agent-launcher.js';
import type { PlatformProvider, IssueDetail } from '../src/platform/provider.js';
import type { WorktreeInfo } from '../src/git/worktree.js';
import type { CostReport } from '../src/reporting/types.js';
import type { TokenSummary } from '../src/budget/token-tracker.js';

// ── Hoisted mock functions ────────────────────────────────────────────────────

const {
  mockRetryExecutorExecute,
  mockContextBuildForPRComposer,
  mockParsePRContent,
  mockCommitGetDiff,
  mockCommitPush,
  mockCommitSquash,
  mockFsWriteFile,
  mockTokenTrackerGetRecords,
  mockTokenTrackerGetByPhase,
  mockTokenTrackerGetTotal,
  mockTokenTrackerGetSummary,
} = vi.hoisted(() => ({
  mockRetryExecutorExecute: vi.fn(),
  mockContextBuildForPRComposer: vi.fn().mockResolvedValue('/tmp/pr-ctx.json'),
  mockParsePRContent: vi.fn().mockResolvedValue({ title: 'Test PR Title', body: 'PR body content.' }),
  mockCommitGetDiff: vi.fn().mockResolvedValue('diff --git a/src/index.ts b/src/index.ts'),
  mockCommitPush: vi.fn().mockResolvedValue(undefined),
  mockCommitSquash: vi.fn().mockResolvedValue(undefined),
  mockFsWriteFile: vi.fn().mockResolvedValue(undefined),
  mockTokenTrackerGetRecords: vi.fn().mockReturnValue([
    { issueNumber: 42, agent: 'issue-analyst', phase: 1, tokens: 1000, input: 750, output: 250, timestamp: '2024-01-01T00:00:00Z' },
  ]),
  mockTokenTrackerGetByPhase: vi.fn().mockReturnValue({ 1: 1000 }),
  mockTokenTrackerGetTotal: vi.fn().mockReturnValue(1000),
  mockTokenTrackerGetSummary: vi.fn().mockReturnValue({
    total: 1000,
    byIssue: {},
    byAgent: {},
    byPhase: {},
    recordCount: 1,
  } as TokenSummary),
}));

// ── Module mocks ──────────────────────────────────────────────────────────────

vi.mock('../src/core/phase-gate.js', () => ({
  AnalysisToPlanningGate: vi.fn(() => ({ validate: vi.fn().mockResolvedValue({ status: 'pass', warnings: [], errors: [] }) })),
  PlanningToImplementationGate: vi.fn(() => ({ validate: vi.fn().mockResolvedValue({ status: 'pass', warnings: [], errors: [] }) })),
  ImplementationToIntegrationGate: vi.fn(() => ({ validate: vi.fn().mockResolvedValue({ status: 'pass', warnings: [], errors: [] }) })),
  IntegrationToPRGate: vi.fn(() => ({ validate: vi.fn().mockResolvedValue({ status: 'pass', warnings: [], errors: [] }) })),
}));

vi.mock('../src/core/progress.js', () => ({
  IssueProgressWriter: vi.fn(() => ({
    appendEvent: vi.fn().mockResolvedValue(undefined),
    write: vi.fn().mockResolvedValue(undefined),
  })),
}));

vi.mock('../src/agents/context-builder.js', () => ({
  ContextBuilder: vi.fn(() => ({
    buildForIssueAnalyst: vi.fn().mockResolvedValue('/tmp/ctx.json'),
    buildForCodebaseScout: vi.fn().mockResolvedValue('/tmp/ctx.json'),
    buildForImplementationPlanner: vi.fn().mockResolvedValue('/tmp/ctx.json'),
    buildForCodeWriter: vi.fn().mockResolvedValue('/tmp/ctx.json'),
    buildForTestWriter: vi.fn().mockResolvedValue('/tmp/ctx.json'),
    buildForCodeReviewer: vi.fn().mockResolvedValue('/tmp/ctx.json'),
    buildForFixSurgeon: vi.fn().mockResolvedValue('/tmp/ctx.json'),
    buildForPRComposer: mockContextBuildForPRComposer,
  })),
}));

vi.mock('../src/agents/result-parser.js', () => ({
  ResultParser: vi.fn(() => ({
    parseImplementationPlan: vi.fn().mockResolvedValue([]),
    parseReview: vi.fn().mockResolvedValue({ verdict: 'pass', issues: [], summary: '' }),
    parsePRContent: mockParsePRContent,
  })),
}));

vi.mock('../src/git/commit.js', () => ({
  CommitManager: vi.fn(() => ({
    isClean: vi.fn().mockResolvedValue(true),
    getChangedFiles: vi.fn().mockResolvedValue([]),
    getDiff: mockCommitGetDiff,
    commit: vi.fn().mockResolvedValue(undefined),
    push: mockCommitPush,
    squash: mockCommitSquash,
  })),
}));

vi.mock('../src/execution/retry.js', () => ({
  RetryExecutor: vi.fn(() => ({
    execute: mockRetryExecutorExecute,
  })),
}));

vi.mock('../src/execution/task-queue.js', () => ({
  TaskQueue: vi.fn(() => ({
    topologicalSort: vi.fn().mockReturnValue([]),
    isComplete: vi.fn().mockReturnValue(true),
    getReady: vi.fn().mockReturnValue([]),
    getCounts: vi.fn().mockReturnValue({ total: 0, completed: 0, blocked: 0 }),
    restoreState: vi.fn(),
  })),
  selectNonOverlappingBatch: vi.fn().mockReturnValue([]),
}));

vi.mock('../src/budget/token-tracker.js', () => ({
  TokenTracker: vi.fn(() => ({
    record: vi.fn(),
    recordDetailed: vi.fn(),
    importRecords: vi.fn(),
    getTotal: mockTokenTrackerGetTotal,
    getRecords: mockTokenTrackerGetRecords,
    getByPhase: mockTokenTrackerGetByPhase,
    getSummary: mockTokenTrackerGetSummary,
    checkIssueBudget: vi.fn().mockReturnValue('ok'),
  })),
}));

vi.mock('../src/util/fs.js', () => ({
  ensureDir: vi.fn().mockResolvedValue(undefined),
  atomicWriteJSON: vi.fn().mockResolvedValue(undefined),
  exists: vi.fn().mockResolvedValue(false),
  listFilesRecursive: vi.fn().mockResolvedValue(['src/index.ts']),
  readJSON: vi.fn().mockResolvedValue(null),
}));

vi.mock('../src/util/process.js', () => ({
  execShell: vi.fn().mockResolvedValue({ exitCode: 0, stdout: '', stderr: '' }),
}));

vi.mock('node:fs/promises', () => ({
  writeFile: mockFsWriteFile,
  readFile: vi.fn().mockResolvedValue(''),
  mkdir: vi.fn().mockResolvedValue(undefined),
  access: vi.fn().mockResolvedValue(undefined),
  rename: vi.fn().mockResolvedValue(undefined),
  readdir: vi.fn().mockResolvedValue([]),
  stat: vi.fn().mockResolvedValue({ isFile: () => true }),
  rm: vi.fn().mockResolvedValue(undefined),
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeConfig(overrides: Partial<CadreConfig['pullRequest']> = {}): CadreConfig {
  return {
    projectName: 'test',
    repository: 'owner/repo',
    platform: 'github',
    repoPath: '/tmp/repo',
    baseBranch: 'main',
    branchTemplate: 'cadre/issue-{issue}',
    issues: { ids: [42] },
    commits: {
      conventional: true,
      sign: false,
      commitPerPhase: false,
      squashBeforePR: false,
    },
    pullRequest: {
      autoCreate: true,
      draft: false,
      labels: [],
      reviewers: [],
      linkIssue: false,
      ...overrides,
    },
    options: {
      maxParallelIssues: 1,
      maxParallelAgents: 1,
      maxRetriesPerTask: 1,
      dryRun: false,
      resume: false,
      invocationDelayMs: 0,
      buildVerification: false,
      testVerification: false,
    },
    commands: {},
    copilot: { cliCommand: 'copilot', agentDir: '.agents', timeout: 300000, model: 'claude-sonnet-4.6' },
    environment: { inheritShellPath: true, extraPath: [] },
  } as unknown as CadreConfig;
}

function makeIssue(): IssueDetail {
  return {
    number: 42,
    title: 'Test Issue',
    body: 'Test body',
    labels: [],
    assignees: [],
    comments: [],
    state: 'open',
    createdAt: '2024-01-01T00:00:00Z',
    updatedAt: '2024-01-01T00:00:00Z',
    linkedPRs: [],
  } as unknown as IssueDetail;
}

function makeWorktree(): WorktreeInfo {
  return {
    issueNumber: 42,
    path: '/tmp/worktree-42',
    branch: 'cadre/issue-42',
    exists: true,
    baseCommit: 'abc123',
  } as unknown as WorktreeInfo;
}

/** Checkpoint with phases 1-4 pre-completed so phase 5 (PR Composition) runs. */
function makeCheckpointPhase5(): CheckpointManager {
  const completedPhaseIds = [1, 2, 3, 4];
  return {
    load: vi.fn().mockResolvedValue({}),
    getState: vi.fn().mockReturnValue({
      issueNumber: 42,
      currentPhase: 5,
      completedPhases: completedPhaseIds,
      completedTasks: [],
      blockedTasks: [],
      failedTasks: [],
      phaseOutputs: {},
      gateResults: {},
      tokenUsage: { total: 0, byPhase: {}, byAgent: {} },
      worktreePath: '/tmp/worktree-42',
      branchName: 'cadre/issue-42',
      baseCommit: 'abc123',
    }),
    getResumePoint: vi.fn().mockReturnValue({ phase: 1, task: null }),
    getTokenRecords: vi.fn().mockReturnValue([]),
    isPhaseCompleted: vi.fn().mockImplementation((phaseId: number) => completedPhaseIds.includes(phaseId)),
    startPhase: vi.fn().mockResolvedValue(undefined),
    completePhase: vi.fn().mockResolvedValue(undefined),
    isTaskCompleted: vi.fn().mockReturnValue(false),
    startTask: vi.fn().mockResolvedValue(undefined),
    completeTask: vi.fn().mockResolvedValue(undefined),
    failTask: vi.fn().mockResolvedValue(undefined),
    blockTask: vi.fn().mockResolvedValue(undefined),
    recordTokenUsage: vi.fn().mockResolvedValue(undefined),
    recordGateResult: vi.fn().mockResolvedValue(undefined),
  } as unknown as CheckpointManager;
}

function makeLauncher(): AgentLauncher {
  return {
    init: vi.fn().mockResolvedValue(undefined),
    launchAgent: vi.fn().mockResolvedValue({
      agent: 'pr-composer',
      success: true,
      exitCode: 0,
      timedOut: false,
      duration: 100,
      stdout: '',
      stderr: '',
      tokenUsage: 0,
      outputPath: '',
      outputExists: true,
    }),
  } as unknown as AgentLauncher;
}

function makePlatform(createPRMock = vi.fn().mockResolvedValue({ number: 1, url: 'https://example.com/pr/1' })): PlatformProvider {
  return {
    name: 'GitHub',
    createPullRequest: createPRMock,
    issueLinkSuffix: vi.fn().mockImplementation((n: number) => `Closes #${n}`),
    addIssueComment: vi.fn().mockResolvedValue(undefined),
  } as unknown as PlatformProvider;
}

function makeLogger() {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}

function makeOrchestrator(config: CadreConfig, platform: PlatformProvider) {
  return new IssueOrchestrator(
    config,
    makeIssue(),
    makeWorktree(),
    makeCheckpointPhase5(),
    makeLauncher(),
    platform,
    makeLogger() as any,
  );
}

/** Capture the body passed to createPullRequest from platform mock calls. */
function getCapturedPRBody(createPRMock: ReturnType<typeof vi.fn>): string {
  expect(createPRMock).toHaveBeenCalledOnce();
  return createPRMock.mock.calls[0][0].body as string;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('IssueOrchestrator – executePRComposition() PR body Token Usage section', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Default: retry executor calls fn directly and returns success
    mockRetryExecutorExecute.mockImplementation(async ({ fn }: { fn: (attempt: number) => Promise<any> }) => {
      try {
        const result = await fn(1);
        return { success: true, result, attempts: 1, recoveryUsed: false };
      } catch (err) {
        return { success: false, error: String(err), attempts: 1, recoveryUsed: false };
      }
    });

    // Default: parsePRContent returns a body
    mockParsePRContent.mockResolvedValue({ title: 'Test PR Title', body: 'PR body content.' });

    // Default: token tracker returns one record so cost report has real data
    mockTokenTrackerGetRecords.mockReturnValue([
      { issueNumber: 42, agent: 'issue-analyst', phase: 1, tokens: 1000, input: 750, output: 250, timestamp: '2024-01-01T00:00:00Z' },
    ]);
    mockTokenTrackerGetByPhase.mockReturnValue({ 1: 1000 });
    mockTokenTrackerGetTotal.mockReturnValue(1000);
    mockTokenTrackerGetSummary.mockReturnValue({
      total: 1000,
      byIssue: {},
      byAgent: {},
      byPhase: {},
      recordCount: 1,
    });
  });

  it('should append a "## Token Usage" section to PR body when cost report is available', async () => {
    const createPRMock = vi.fn().mockResolvedValue({ number: 1, url: 'https://example.com/pr/1' });
    const platform = makePlatform(createPRMock);
    const orchestrator = makeOrchestrator(makeConfig(), platform);

    await orchestrator.run();

    const body = getCapturedPRBody(createPRMock);
    expect(body).toContain('## Token Usage');
  });

  it('should include totalTokens in the Token Usage section', async () => {
    const createPRMock = vi.fn().mockResolvedValue({ number: 1, url: 'https://example.com/pr/1' });
    const platform = makePlatform(createPRMock);
    const orchestrator = makeOrchestrator(makeConfig(), platform);

    await orchestrator.run();

    const body = getCapturedPRBody(createPRMock);
    expect(body).toContain('Total tokens');
  });

  it('should include inputTokens in the Token Usage section', async () => {
    const createPRMock = vi.fn().mockResolvedValue({ number: 1, url: 'https://example.com/pr/1' });
    const platform = makePlatform(createPRMock);
    const orchestrator = makeOrchestrator(makeConfig(), platform);

    await orchestrator.run();

    const body = getCapturedPRBody(createPRMock);
    expect(body).toContain('Input tokens');
  });

  it('should include outputTokens in the Token Usage section', async () => {
    const createPRMock = vi.fn().mockResolvedValue({ number: 1, url: 'https://example.com/pr/1' });
    const platform = makePlatform(createPRMock);
    const orchestrator = makeOrchestrator(makeConfig(), platform);

    await orchestrator.run();

    const body = getCapturedPRBody(createPRMock);
    expect(body).toContain('Output tokens');
  });

  it('should include estimatedCost in the Token Usage section', async () => {
    const createPRMock = vi.fn().mockResolvedValue({ number: 1, url: 'https://example.com/pr/1' });
    const platform = makePlatform(createPRMock);
    const orchestrator = makeOrchestrator(makeConfig(), platform);

    await orchestrator.run();

    const body = getCapturedPRBody(createPRMock);
    expect(body).toContain('Estimated cost');
  });

  it('should include model in the Token Usage section', async () => {
    const createPRMock = vi.fn().mockResolvedValue({ number: 1, url: 'https://example.com/pr/1' });
    const platform = makePlatform(createPRMock);
    const orchestrator = makeOrchestrator(makeConfig(), platform);

    await orchestrator.run();

    const body = getCapturedPRBody(createPRMock);
    expect(body).toContain('Model');
    expect(body).toContain('claude-sonnet-4.6');
  });

  it('should place the Token Usage section after the issue link suffix when linkIssue is true', async () => {
    const createPRMock = vi.fn().mockResolvedValue({ number: 1, url: 'https://example.com/pr/1' });
    const platform = makePlatform(createPRMock);
    const config = makeConfig({ autoCreate: true, linkIssue: true });
    const orchestrator = makeOrchestrator(config, platform);

    await orchestrator.run();

    const body = getCapturedPRBody(createPRMock);
    const linkIndex = body.indexOf('Closes #42');
    const tokenSectionIndex = body.indexOf('## Token Usage');

    expect(linkIndex).toBeGreaterThanOrEqual(0);
    expect(tokenSectionIndex).toBeGreaterThanOrEqual(0);
    expect(tokenSectionIndex).toBeGreaterThan(linkIndex);
  });

  it('should omit Token Usage section gracefully when buildCostReportData fails', async () => {
    // Cause buildCostReportData to throw by making getRecords throw
    mockTokenTrackerGetRecords.mockImplementation(() => {
      throw new Error('token tracker unavailable');
    });

    const createPRMock = vi.fn().mockResolvedValue({ number: 1, url: 'https://example.com/pr/1' });
    const platform = makePlatform(createPRMock);
    const orchestrator = makeOrchestrator(makeConfig(), platform);

    const result = await orchestrator.run();

    // run() should still succeed
    expect(result.success).toBe(true);

    // PR should still be created without Token Usage section
    expect(createPRMock).toHaveBeenCalledOnce();
    const body = createPRMock.mock.calls[0][0].body as string;
    expect(body).not.toContain('## Token Usage');
  });

  it('should not append Token Usage section when autoCreate is false', async () => {
    const createPRMock = vi.fn().mockResolvedValue({ number: 1, url: 'https://example.com/pr/1' });
    const platform = makePlatform(createPRMock);
    const config = makeConfig({ autoCreate: false });
    const orchestrator = makeOrchestrator(config, platform);

    await orchestrator.run();

    // createPullRequest should not have been called at all
    expect(createPRMock).not.toHaveBeenCalled();
  });
});

describe('IssueOrchestrator – executePRComposition() buildForPRComposer token argument', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mockRetryExecutorExecute.mockImplementation(async ({ fn }: { fn: (attempt: number) => Promise<any> }) => {
      try {
        const result = await fn(1);
        return { success: true, result, attempts: 1, recoveryUsed: false };
      } catch (err) {
        return { success: false, error: String(err), attempts: 1, recoveryUsed: false };
      }
    });

    mockParsePRContent.mockResolvedValue({ title: 'Test PR Title', body: 'PR body content.' });
  });

  it('should pass the full CostReport to buildForPRComposer when token records are available', async () => {
    mockTokenTrackerGetRecords.mockReturnValue([
      { issueNumber: 42, agent: 'issue-analyst', phase: 1, tokens: 2000, input: 1500, output: 500, timestamp: '2024-01-01T00:00:00Z' },
    ]);
    mockTokenTrackerGetByPhase.mockReturnValue({ 1: 2000 });
    mockTokenTrackerGetTotal.mockReturnValue(2000);

    const platform = makePlatform();
    const orchestrator = makeOrchestrator(makeConfig({ autoCreate: false }), platform);

    await orchestrator.run();

    expect(mockContextBuildForPRComposer).toHaveBeenCalledOnce();
    const tokenSummaryArg = mockContextBuildForPRComposer.mock.calls[0][8] as CostReport | undefined;

    // Should be a CostReport (has issueNumber, byAgent, byPhase)
    expect(tokenSummaryArg).toBeDefined();
    expect(tokenSummaryArg).toHaveProperty('issueNumber', 42);
    expect(tokenSummaryArg).toHaveProperty('totalTokens');
    expect(tokenSummaryArg).toHaveProperty('inputTokens');
    expect(tokenSummaryArg).toHaveProperty('outputTokens');
    expect(tokenSummaryArg).toHaveProperty('estimatedCost');
    expect(tokenSummaryArg).toHaveProperty('model');
    expect(tokenSummaryArg).toHaveProperty('byAgent');
    expect(tokenSummaryArg).toHaveProperty('byPhase');
  });

  it('should fall back to TokenSummary for buildForPRComposer when buildCostReportData fails', async () => {
    mockTokenTrackerGetRecords.mockImplementation(() => {
      throw new Error('token tracker unavailable');
    });
    const expectedSummary: TokenSummary = {
      total: 500,
      byIssue: {},
      byAgent: {},
      byPhase: {},
      recordCount: 0,
    };
    mockTokenTrackerGetSummary.mockReturnValue(expectedSummary);

    const platform = makePlatform();
    const orchestrator = makeOrchestrator(makeConfig({ autoCreate: false }), platform);

    await orchestrator.run();

    expect(mockContextBuildForPRComposer).toHaveBeenCalledOnce();
    const tokenSummaryArg = mockContextBuildForPRComposer.mock.calls[0][8];

    // Should be a TokenSummary (has 'total', not 'issueNumber')
    expect(tokenSummaryArg).toBeDefined();
    expect(tokenSummaryArg).toHaveProperty('total', 500);
    expect(tokenSummaryArg).not.toHaveProperty('issueNumber');
  });
});
