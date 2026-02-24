import { describe, it, expect, vi, beforeEach } from 'vitest';
import { IssueOrchestrator } from '../src/core/issue-orchestrator.js';
import { makeRuntimeConfig } from './helpers/make-runtime-config.js';
import type { CheckpointManager } from '../src/core/checkpoint.js';
import type { AgentLauncher } from '../src/core/agent-launcher.js';
import type { PlatformProvider, IssueDetail } from '../src/platform/provider.js';
import type { WorktreeInfo } from '../src/git/worktree.js';

// ── Hoisted mocks ─────────────────────────────────────────────────────────────

const {
  mockNotifyAmbiguities,
  mockAnalysisGateValidate,
  mockAmbiguityGateValidate,
  mockReadFile,
  mockRetryExecutorExecute,
  mockProgressAppendEvent,
} = vi.hoisted(() => ({
  mockNotifyAmbiguities: vi.fn().mockResolvedValue(undefined),
  mockAnalysisGateValidate: vi.fn(),
  mockAmbiguityGateValidate: vi.fn(),
  mockReadFile: vi.fn(),
  mockRetryExecutorExecute: vi.fn(),
  mockProgressAppendEvent: vi.fn().mockResolvedValue(undefined),
}));

// ── Module mocks ──────────────────────────────────────────────────────────────

vi.mock('../src/core/issue-notifier.js', () => ({
  IssueNotifier: vi.fn().mockImplementation(() => {
    const methods = {
      notifyStart: vi.fn().mockResolvedValue(undefined),
      notifyPhaseComplete: vi.fn().mockResolvedValue(undefined),
      notifyComplete: vi.fn().mockResolvedValue(undefined),
      notifyFailed: vi.fn().mockResolvedValue(undefined),
      notifyBudgetWarning: vi.fn().mockResolvedValue(undefined),
      notifyAmbiguities: mockNotifyAmbiguities,
      notify: vi.fn().mockImplementation(async (event: any) => {
        if (event.type === 'ambiguity-detected') return mockNotifyAmbiguities(event.issueNumber, event.ambiguities);
      }),
    };
    return methods;
  }),
}));

vi.mock('../src/core/phase-gate.js', () => ({
  AnalysisToPlanningGate: vi.fn(() => ({ validate: mockAnalysisGateValidate })),
  PlanningToImplementationGate: vi.fn(() => ({ validate: vi.fn(async () => ({ status: 'pass', warnings: [], errors: [] })) })),
  ImplementationToIntegrationGate: vi.fn(() => ({ validate: vi.fn(async () => ({ status: 'pass', warnings: [], errors: [] })) })),
  IntegrationToPRGate: vi.fn(() => ({ validate: vi.fn(async () => ({ status: 'pass', warnings: [], errors: [] })) })),
  AnalysisAmbiguityGate: vi.fn(() => ({ validate: mockAmbiguityGateValidate })),
}));

vi.mock('../src/core/progress.js', () => ({
  IssueProgressWriter: vi.fn(() => ({
    appendEvent: mockProgressAppendEvent,
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
    buildForPRComposer: vi.fn().mockResolvedValue('/tmp/ctx.json'),
  })),
}));

vi.mock('../src/agents/result-parser.js', () => ({
  ResultParser: vi.fn(() => ({
    parseImplementationPlan: vi.fn().mockResolvedValue([]),
    parseReview: vi.fn().mockResolvedValue({ verdict: 'pass', issues: [], summary: '' }),
    parsePRContent: vi.fn().mockResolvedValue({ title: 'PR', body: '', labels: [] }),
  })),
}));

vi.mock('../src/git/commit.js', () => ({
  CommitManager: vi.fn(() => ({
    isClean: vi.fn().mockResolvedValue(true),
    getChangedFiles: vi.fn().mockResolvedValue([]),
    getDiff: vi.fn().mockResolvedValue(''),
    commit: vi.fn().mockResolvedValue(undefined),
    push: vi.fn().mockResolvedValue(undefined),
    squash: vi.fn().mockResolvedValue(undefined),
    stripCadreFiles: vi.fn().mockResolvedValue(undefined),
  })),
}));

vi.mock('../src/execution/retry.js', () => ({
  RetryExecutor: vi.fn(() => ({ execute: mockRetryExecutorExecute })),
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
    getTotal: vi.fn().mockReturnValue(0),
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
  readFile: mockReadFile,
  writeFile: vi.fn().mockResolvedValue(undefined),
  mkdir: vi.fn().mockResolvedValue(undefined),
  access: vi.fn().mockResolvedValue(undefined),
  rename: vi.fn().mockResolvedValue(undefined),
  readdir: vi.fn().mockResolvedValue([]),
  stat: vi.fn().mockResolvedValue({ isFile: () => true }),
  rm: vi.fn().mockResolvedValue(undefined),
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Build an analysis.md string with the given ambiguity items listed under "## Ambiguities". */
function buildAnalysisMd(ambiguities: string[]): string {
  if (ambiguities.length === 0) return '# Analysis\n\nNo ambiguities.\n';
  return [
    '# Analysis',
    '',
    '## Ambiguities',
    ...ambiguities,
    '',
    '## Next Section',
    'Other content.',
  ].join('\n');
}

function makeConfig(overrides: Record<string, unknown> = {}) {
  return makeRuntimeConfig({
    projectName: 'test',
    branchTemplate: 'cadre/issue-{issue}',
    issues: { ids: [42] },
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
      dryRun: false,
      resume: false,
      invocationDelayMs: 0,
      buildVerification: false,
      testVerification: false,
      ambiguityThreshold: 2,
      haltOnAmbiguity: false,
      perTaskBuildCheck: true,
      maxBuildFixRounds: 2,
      skipValidation: false,
      maxIntegrationFixRounds: 1,
      respondToReviews: false,
      ...overrides as Partial<Record<string, unknown>>,
    } as any,
    copilot: { cliCommand: 'copilot', agentDir: '.agents', timeout: 300000, model: 'claude-sonnet-4.6' },
  });
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
  };
}

function makeWorktree(): WorktreeInfo {
  return {
    issueNumber: 42,
    path: '/tmp/worktree-42',
    branch: 'cadre/issue-42',
    exists: true,
    baseCommit: 'abc123',
    syncedAgentFiles: [],
  };
}

/** Checkpoint where phases 2–5 are already complete so only phase 1 runs. */
function makeCheckpointPhase1Only(): CheckpointManager {
  const completedPhaseIds = [2, 3, 4, 5];
  return {
    load: vi.fn().mockResolvedValue({}),
    getState: vi.fn().mockReturnValue({
      issueNumber: 42,
      currentPhase: 1,
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
    isPhaseCompleted: vi.fn().mockImplementation((id: number) => completedPhaseIds.includes(id)),
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

function makeMockLauncher(): AgentLauncher {
  return {
    init: vi.fn().mockResolvedValue(undefined),
    launchAgent: vi.fn().mockResolvedValue({
      agent: 'issue-analyst',
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

function makeMockPlatform(): PlatformProvider {
  return {
    name: 'GitHub',
    createPullRequest: vi.fn().mockResolvedValue({ number: 1, url: 'https://example.com/pr/1' }),
    issueLinkSuffix: vi.fn().mockReturnValue(''),
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

function makeOrchestrator(configOverrides: Record<string, unknown> = {}, logger = makeLogger()) {
  return new IssueOrchestrator(
    makeConfig(configOverrides),
    makeIssue(),
    makeWorktree(),
    makeCheckpointPhase1Only(),
    makeMockLauncher(),
    makeMockPlatform(),
    logger as any,
  );
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('IssueOrchestrator – Ambiguity Logic (task-004)', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Default: phase execution succeeds via RetryExecutor
    mockRetryExecutorExecute.mockImplementation(async ({ fn }: { fn: (attempt: number) => Promise<unknown> }) => {
      try {
        const result = await fn(1);
        return { success: true, result, attempts: 1, recoveryUsed: false };
      } catch (err) {
        return { success: false, error: String(err), attempts: 1, recoveryUsed: false };
      }
    });

    // Default: all gates pass
    mockAnalysisGateValidate.mockResolvedValue({ status: 'pass', warnings: [], errors: [] });
    mockAmbiguityGateValidate.mockResolvedValue({ status: 'pass', warnings: [], errors: [] });

    // Default: analysis.md has no ambiguities
    mockReadFile.mockResolvedValue('# Analysis\n\nNo ambiguities.\n');
  });

  // ── readAmbiguitiesFromAnalysis ───────────────────────────────────────────

  it('should NOT log warn or call notifyAmbiguities when analysis.md has no Ambiguities section', async () => {
    mockReadFile.mockResolvedValue('# Analysis\n\nNo ambiguities section here.\n');
    const logger = makeLogger();
    const orchestrator = makeOrchestrator({}, logger);

    const result = await orchestrator.run();

    expect(result.success).toBe(true);
    const warnCalls = (logger.warn as ReturnType<typeof vi.fn>).mock.calls.map(([msg]: [string]) => msg);
    expect(warnCalls.some((m) => m.toLowerCase().includes('ambiguity'))).toBe(false);
    expect(mockNotifyAmbiguities).not.toHaveBeenCalled();
  });

  it('should NOT call notifyAmbiguities when analysis.md Ambiguities section is empty', async () => {
    mockReadFile.mockResolvedValue('# Analysis\n\n## Ambiguities\n\n## Next Section\nOther.\n');
    const orchestrator = makeOrchestrator();

    await orchestrator.run();

    expect(mockNotifyAmbiguities).not.toHaveBeenCalled();
  });

  it('should log each ambiguity at warn level after phase 1 succeeds', async () => {
    mockReadFile.mockResolvedValue(buildAnalysisMd(['- Unclear requirement A', '- Missing scope for B']));
    const logger = makeLogger();
    const orchestrator = makeOrchestrator({}, logger);

    await orchestrator.run();

    const warnMessages = (logger.warn as ReturnType<typeof vi.fn>).mock.calls.map(([msg]: [string]) => msg);
    expect(warnMessages.some((m) => m.includes('Unclear requirement A'))).toBe(true);
    expect(warnMessages.some((m) => m.includes('Missing scope for B'))).toBe(true);
  });

  it('should call notifyAmbiguities with all ambiguities when the list is non-empty', async () => {
    const ambiguities = ['- Unclear requirement A', '- Missing scope for B'];
    mockReadFile.mockResolvedValue(buildAnalysisMd(ambiguities));
    const orchestrator = makeOrchestrator();

    await orchestrator.run();

    expect(mockNotifyAmbiguities).toHaveBeenCalledTimes(1);
    const [issueNumber, reported] = mockNotifyAmbiguities.mock.calls[0];
    expect(issueNumber).toBe(42);
    expect(reported).toEqual(ambiguities);
  });

  it('should NOT call notifyAmbiguities when analysis.md cannot be read', async () => {
    mockReadFile.mockRejectedValue(new Error('ENOENT'));
    const orchestrator = makeOrchestrator();

    const result = await orchestrator.run();

    expect(result.success).toBe(true);
    expect(mockNotifyAmbiguities).not.toHaveBeenCalled();
  });

  // ── haltOnAmbiguity behaviour ─────────────────────────────────────────────

  it('should halt the pipeline when haltOnAmbiguity is true and count exceeds threshold', async () => {
    // threshold=2, count=3 → should halt
    const ambiguities = ['- A', '- B', '- C'];
    mockReadFile.mockResolvedValue(buildAnalysisMd(ambiguities));
    const orchestrator = makeOrchestrator({ ambiguityThreshold: 2, haltOnAmbiguity: true });

    const result = await orchestrator.run();

    expect(result.success).toBe(false);
    expect(result.error).toContain('ambiguit');
  });

  it('should include the ambiguity count and threshold in the halt message', async () => {
    const ambiguities = ['- A', '- B', '- C'];
    mockReadFile.mockResolvedValue(buildAnalysisMd(ambiguities));
    const orchestrator = makeOrchestrator({ ambiguityThreshold: 2, haltOnAmbiguity: true });

    const result = await orchestrator.run();

    expect(result.error).toContain('3');
    expect(result.error).toContain('2');
  });

  it('should append a halt event to the progress log when pipeline is halted for ambiguities', async () => {
    const ambiguities = ['- A', '- B', '- C'];
    mockReadFile.mockResolvedValue(buildAnalysisMd(ambiguities));
    const orchestrator = makeOrchestrator({ ambiguityThreshold: 2, haltOnAmbiguity: true });

    await orchestrator.run();

    const appendCalls = mockProgressAppendEvent.mock.calls.map(([msg]: [string]) => msg);
    expect(appendCalls.some((m) => m.toLowerCase().includes('halt') && m.toLowerCase().includes('ambiguit'))).toBe(true);
  });

  it('should continue the pipeline when haltOnAmbiguity is false even if count exceeds threshold', async () => {
    // threshold=2, count=3, haltOnAmbiguity=false → should NOT halt
    const ambiguities = ['- A', '- B', '- C'];
    mockReadFile.mockResolvedValue(buildAnalysisMd(ambiguities));
    const orchestrator = makeOrchestrator({ ambiguityThreshold: 2, haltOnAmbiguity: false });

    const result = await orchestrator.run();

    expect(result.success).toBe(true);
  });

  it('should continue the pipeline when count is exactly at the threshold (not strictly exceeding)', async () => {
    // threshold=2, count=2 → count is not > threshold, so should NOT halt even with haltOnAmbiguity=true
    const ambiguities = ['- A', '- B'];
    mockReadFile.mockResolvedValue(buildAnalysisMd(ambiguities));
    const orchestrator = makeOrchestrator({ ambiguityThreshold: 2, haltOnAmbiguity: true });

    const result = await orchestrator.run();

    expect(result.success).toBe(true);
  });

  it('should still log ambiguities and call notifyAmbiguities before halting the pipeline', async () => {
    const ambiguities = ['- A', '- B', '- C'];
    mockReadFile.mockResolvedValue(buildAnalysisMd(ambiguities));
    const logger = makeLogger();
    const orchestrator = makeOrchestrator({ ambiguityThreshold: 2, haltOnAmbiguity: true }, logger);

    const result = await orchestrator.run();

    expect(result.success).toBe(false);
    // Ambiguities should still be logged and notified before halting
    const warnMessages = (logger.warn as ReturnType<typeof vi.fn>).mock.calls.map(([msg]: [string]) => msg);
    expect(warnMessages.some((m) => m.includes('- A'))).toBe(true);
    expect(mockNotifyAmbiguities).toHaveBeenCalledTimes(1);
  });

  // ── AnalysisAmbiguityGate wiring ──────────────────────────────────────────

  it('should invoke AnalysisAmbiguityGate.validate during phase 1 gate run', async () => {
    const orchestrator = makeOrchestrator();

    await orchestrator.run();

    expect(mockAmbiguityGateValidate).toHaveBeenCalledTimes(1);
  });

  it('should pass the same GateContext to AnalysisAmbiguityGate as to AnalysisToPlanningGate', async () => {
    const orchestrator = makeOrchestrator();

    await orchestrator.run();

    const [analysisCtx] = mockAnalysisGateValidate.mock.calls[0];
    const [ambiguityCtx] = mockAmbiguityGateValidate.mock.calls[0];
    expect(ambiguityCtx.worktreePath).toBe(analysisCtx.worktreePath);
    expect(ambiguityCtx.progressDir).toBe(analysisCtx.progressDir);
    expect(ambiguityCtx.baseCommit).toBe(analysisCtx.baseCommit);
  });

  it('should fail the phase 1 gate when AnalysisAmbiguityGate returns fail (merged result)', async () => {
    // AnalysisToPlanningGate passes, but AnalysisAmbiguityGate fails
    mockAnalysisGateValidate.mockResolvedValue({ status: 'pass', warnings: [], errors: [] });
    mockAmbiguityGateValidate
      .mockResolvedValueOnce({ status: 'fail', warnings: [], errors: ['too many ambiguities'] })
      .mockResolvedValueOnce({ status: 'pass', warnings: [], errors: [] });

    const orchestrator = makeOrchestrator();

    const result = await orchestrator.run();

    // Gate failed triggers retry; second attempt passes → overall success
    expect(mockAmbiguityGateValidate).toHaveBeenCalledTimes(2);
    expect(result.success).toBe(true);
  });

  it('should abort pipeline when merged gate (ambiguity) fails both times', async () => {
    mockAnalysisGateValidate.mockResolvedValue({ status: 'pass', warnings: [], errors: [] });
    mockAmbiguityGateValidate.mockResolvedValue({
      status: 'fail',
      warnings: [],
      errors: ['ambiguity threshold exceeded'],
    });

    const orchestrator = makeOrchestrator();

    const result = await orchestrator.run();

    expect(result.success).toBe(false);
    expect(mockAmbiguityGateValidate).toHaveBeenCalledTimes(2);
  });

  it('should produce a warn merged result when AnalysisAmbiguityGate warns and AnalysisToPlanningGate passes', async () => {
    const checkpoint = makeCheckpointPhase1Only();
    mockAnalysisGateValidate.mockResolvedValue({ status: 'pass', warnings: [], errors: [] });
    mockAmbiguityGateValidate.mockResolvedValue({ status: 'warn', warnings: ['approaching threshold'], errors: [] });

    const orchestrator = new IssueOrchestrator(
      makeConfig(),
      makeIssue(),
      makeWorktree(),
      checkpoint,
      makeMockLauncher(),
      makeMockPlatform(),
      makeLogger() as any,
    );

    const result = await orchestrator.run();

    // warn does not halt the pipeline
    expect(result.success).toBe(true);
    // Gate result recorded should reflect the merged warn
    expect(checkpoint.recordGateResult).toHaveBeenCalledWith(
      1,
      expect.objectContaining({ status: 'warn' }),
    );
  });
});
