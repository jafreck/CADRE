import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FleetOrchestrator } from '../src/core/fleet-orchestrator.js';
import type { CadreConfig } from '../src/config/schema.js';
import type { IssueDetail } from '../src/platform/provider.js';
import type { Logger } from '../src/logging/logger.js';

// --- Module mocks ---

vi.mock('p-limit', () => ({
  default: () => (fn: () => unknown) => fn(),
}));

vi.mock('../src/core/checkpoint.js', () => ({
  FleetCheckpointManager: vi.fn().mockImplementation(() => ({
    load: vi.fn().mockResolvedValue(undefined),
    isIssueCompleted: vi.fn().mockReturnValue(false),
    setIssueStatus: vi.fn().mockResolvedValue(undefined),
    recordTokenUsage: vi.fn().mockResolvedValue(undefined),
    getIssueStatus: vi.fn().mockReturnValue({ status: 'completed', lastPhase: 5 }),
  })),
  CheckpointManager: vi.fn().mockImplementation(() => ({
    load: vi.fn().mockResolvedValue({}),
    setWorktreeInfo: vi.fn().mockResolvedValue(undefined),
  })),
}));

vi.mock('../src/core/progress.js', () => ({
  FleetProgressWriter: vi.fn().mockImplementation(() => ({
    appendEvent: vi.fn().mockResolvedValue(undefined),
    write: vi.fn().mockResolvedValue(undefined),
  })),
}));

vi.mock('../src/core/issue-orchestrator.js', () => ({
  IssueOrchestrator: vi.fn().mockImplementation(() => ({
    run: vi.fn().mockResolvedValue({
      issueNumber: 1,
      issueTitle: 'Fix bug',
      success: true,
      phases: [{ id: 1 }],
      pr: { number: 10, url: 'https://github.com/owner/repo/pull/10' },
      totalDuration: 2000,
      tokenUsage: 1000,
    }),
  })),
}));

vi.mock('../src/git/worktree.js', () => ({
  WorktreeManager: vi.fn().mockImplementation(() => ({
    provision: vi.fn().mockResolvedValue({
      path: '/tmp/worktree/1',
      branch: 'cadre/issue-1',
      baseCommit: 'abc123',
      issueNumber: 1,
    }),
  })),
}));

vi.mock('../src/core/agent-launcher.js', () => ({
  AgentLauncher: vi.fn().mockImplementation(() => ({})),
}));

vi.mock('../src/core/phase-registry.js', () => ({
  getPhaseCount: vi.fn().mockReturnValue(5),
  ISSUE_PHASES: [
    { id: 1, name: 'Analysis & Scouting', critical: true },
    { id: 2, name: 'Planning', critical: true },
    { id: 3, name: 'Implementation', critical: true },
    { id: 4, name: 'Integration Verification', critical: false },
    { id: 5, name: 'PR Composition', critical: false },
  ],
}));

vi.mock('../src/budget/token-tracker.js', () => ({
  TokenTracker: vi.fn().mockImplementation(() => ({
    record: vi.fn(),
    checkFleetBudget: vi.fn().mockReturnValue('ok'),
    getTotal: vi.fn().mockReturnValue(1000),
    getSummary: vi.fn().mockReturnValue({
      total: 1000,
      byIssue: { 1: 1000 },
      byAgent: {},
      byPhase: {},
    }),
  })),
}));

vi.mock('../src/budget/cost-estimator.js', () => ({
  CostEstimator: vi.fn().mockImplementation(() => ({
    estimate: vi.fn().mockReturnValue(0.01),
    estimateIssueTokens: vi.fn().mockReturnValue(5000),
  })),
}));

const mockBuildReport = vi.fn().mockReturnValue({ runId: 'test-report' });
const mockWrite = vi.fn().mockResolvedValue('/repo/.cadre/reports/run-report-test.json');

vi.mock('../src/reporting/report-writer.js', () => ({
  ReportWriter: vi.fn().mockImplementation(() => ({
    buildReport: mockBuildReport,
    write: mockWrite,
  })),
}));

// --- Helpers ---

const makeConfig = (): CadreConfig =>
  ({
    projectName: 'test-project',
    repoPath: '/repo',
    repository: 'owner/repo',
    baseBranch: 'main',
    branchTemplate: 'cadre/issue-{number}',
    copilot: {
      model: 'gpt-4o',
      cliCommand: 'copilot',
      agentDir: '.github/agents',
      timeout: 300000,
    },
    options: {
      maxParallelIssues: 2,
      tokenBudget: 100000,
      resume: false,
    },
    issues: { ids: [1] },
  }) as unknown as CadreConfig;

const makeIssues = (): IssueDetail[] => [
  {
    number: 1,
    title: 'Fix bug',
    body: '',
    labels: [],
    url: 'https://github.com/owner/repo/issues/1',
  } as unknown as IssueDetail,
];

const makeLogger = (): Logger =>
  ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    child: vi.fn().mockReturnValue({
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }),
  }) as unknown as Logger;

const makePlatform = () => ({});

const makeWorktreeManager = () =>
  ({
    provision: vi.fn().mockResolvedValue({
      path: '/tmp/worktree/1',
      branch: 'cadre/issue-1',
      baseCommit: 'abc123',
      issueNumber: 1,
    }),
  }) as never;

// --- Tests ---

describe('FleetOrchestrator - ReportWriter integration', () => {
  let config: CadreConfig;
  let issues: IssueDetail[];
  let logger: Logger;

  beforeEach(() => {
    vi.clearAllMocks();
    config = makeConfig();
    issues = makeIssues();
    logger = makeLogger();
    mockBuildReport.mockReturnValue({ runId: 'test-report' });
    mockWrite.mockResolvedValue('/repo/.cadre/reports/run-report-test.json');
  });

  it('should call ReportWriter.buildReport after aggregating results', async () => {
    const orchestrator = new FleetOrchestrator(
      config,
      issues,
      makeWorktreeManager(),
      {} as never,
      makePlatform() as never,
      logger,
    );

    await orchestrator.run();

    expect(mockBuildReport).toHaveBeenCalledOnce();
  });

  it('should call ReportWriter.write with the built report', async () => {
    const orchestrator = new FleetOrchestrator(
      config,
      issues,
      makeWorktreeManager(),
      {} as never,
      makePlatform() as never,
      logger,
    );

    await orchestrator.run();

    expect(mockWrite).toHaveBeenCalledOnce();
    expect(mockWrite).toHaveBeenCalledWith({ runId: 'test-report' });
  });

  it('should log the report path via logger.info after writing', async () => {
    const orchestrator = new FleetOrchestrator(
      config,
      issues,
      makeWorktreeManager(),
      {} as never,
      makePlatform() as never,
      logger,
    );

    await orchestrator.run();

    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining('/repo/.cadre/reports/run-report-test.json'),
    );
  });

  it('should log a warning and not throw when report writing fails', async () => {
    mockWrite.mockRejectedValueOnce(new Error('disk full'));

    const orchestrator = new FleetOrchestrator(
      config,
      issues,
      makeWorktreeManager(),
      {} as never,
      makePlatform() as never,
      logger,
    );

    const result = await orchestrator.run();

    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('Failed to write run report'),
    );
    expect(result).toBeDefined();
    expect(result.success).toBe(true);
  });

  it('should still return a valid FleetResult when report writing throws', async () => {
    mockWrite.mockRejectedValueOnce(new Error('permission denied'));

    const orchestrator = new FleetOrchestrator(
      config,
      issues,
      makeWorktreeManager(),
      {} as never,
      makePlatform() as never,
      logger,
    );

    const result = await orchestrator.run();

    expect(result.issues).toHaveLength(1);
    expect(result.prsCreated).toHaveLength(1);
    expect(result.failedIssues).toHaveLength(0);
  });

  it('should pass fleetResult, issues, and startTime to buildReport', async () => {
    const orchestrator = new FleetOrchestrator(
      config,
      issues,
      makeWorktreeManager(),
      {} as never,
      makePlatform() as never,
      logger,
    );

    await orchestrator.run();

    expect(mockBuildReport).toHaveBeenCalledWith(
      expect.objectContaining({ success: true }),
      issues,
      expect.any(Number),
    );
  });
});
