import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FleetReporter } from '../src/core/fleet-reporter.js';
import type { FleetResult } from '../src/core/fleet-orchestrator.js';
import type { IssueResult } from '../src/core/issue-orchestrator.js';
import type { IssueDetail } from '../src/platform/provider.js';

vi.mock('../src/core/phase-registry.js', () => ({
  getPhaseCount: vi.fn().mockReturnValue(5),
}));

vi.mock('../src/reporting/report-writer.js', () => ({
  ReportWriter: vi.fn().mockImplementation(() => ({
    buildReport: vi.fn().mockReturnValue({ summary: 'test' }),
    write: vi.fn().mockResolvedValue('/tmp/report.md'),
  })),
}));

vi.mock('../src/budget/cost-estimator.js', () => ({
  CostEstimator: vi.fn().mockImplementation(() => ({})),
}));

function makeIssue(number: number): IssueDetail {
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

function makeConfig() {
  return {
    options: { tokenBudget: 100000 },
    agent: {
      backend: 'copilot',
      model: 'gpt-4',
      timeout: 300000,
      copilot: { cliCommand: 'copilot', agentDir: '/tmp' },
      claude: { cliCommand: 'claude', agentDir: '/tmp' },
    },
  } as any;
}

function makeDeps() {
  const fleetCheckpoint = {
    getIssueStatus: vi.fn().mockReturnValue(null),
  };
  const fleetProgress = {
    write: vi.fn().mockResolvedValue(undefined),
    appendEvent: vi.fn().mockResolvedValue(undefined),
  };
  const tokenTracker = {
    getTotal: vi.fn().mockReturnValue(5000),
    getSummary: vi.fn().mockReturnValue({
      total: 5000,
      byIssue: { 1: 3000, 2: 2000 },
      byAgent: { 'code-writer': 5000 },
      byPhase: { 3: 5000 },
      recordCount: 2,
    }),
  };
  const logger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };
  return { fleetCheckpoint, fleetProgress, tokenTracker, logger };
}

describe('FleetReporter', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('aggregateResults', () => {
    it('should return success=true when all results are fulfilled and successful', () => {
      const issues = [makeIssue(1), makeIssue(2)];
      const { fleetCheckpoint, fleetProgress, tokenTracker, logger } = makeDeps();
      const reporter = new FleetReporter(
        makeConfig(), issues, fleetCheckpoint as any, fleetProgress as any, tokenTracker as any, logger as any,
      );

      const results: PromiseSettledResult<IssueResult>[] = [
        {
          status: 'fulfilled',
          value: {
            issueNumber: 1, issueTitle: 'Issue 1', success: true,
            codeComplete: true, phases: [], totalDuration: 100, tokenUsage: 3000,
            pr: { number: 10, url: 'https://github.com/owner/repo/pull/10', title: 'PR 10', branch: 'cadre/issue-1' },
          },
        },
        {
          status: 'fulfilled',
          value: {
            issueNumber: 2, issueTitle: 'Issue 2', success: true,
            codeComplete: true, phases: [], totalDuration: 200, tokenUsage: 2000,
          },
        },
      ];

      const startTime = Date.now() - 1000;
      const result = reporter.aggregateResults(results, startTime);

      expect(result.success).toBe(true);
      expect(result.issues).toHaveLength(2);
      expect(result.prsCreated).toHaveLength(1);
      expect(result.failedIssues).toHaveLength(0);
      expect(result.codeDoneNoPR).toHaveLength(0);
      expect(result.totalDuration).toBeGreaterThanOrEqual(1000);
    });

    it('should return success=false when some results failed', () => {
      const issues = [makeIssue(1)];
      const { fleetCheckpoint, fleetProgress, tokenTracker, logger } = makeDeps();
      const reporter = new FleetReporter(
        makeConfig(), issues, fleetCheckpoint as any, fleetProgress as any, tokenTracker as any, logger as any,
      );

      const results: PromiseSettledResult<IssueResult>[] = [
        {
          status: 'fulfilled',
          value: {
            issueNumber: 1, issueTitle: 'Issue 1', success: false,
            codeComplete: false, phases: [], totalDuration: 100, tokenUsage: 1000,
            error: 'Build failed',
          },
        },
      ];

      const result = reporter.aggregateResults(results, Date.now());

      expect(result.success).toBe(false);
      expect(result.failedIssues).toHaveLength(1);
      expect(result.failedIssues[0]).toEqual({ issueNumber: 1, error: 'Build failed' });
    });

    it('should handle rejected promises in results', () => {
      const issues = [makeIssue(1)];
      const { fleetCheckpoint, fleetProgress, tokenTracker, logger } = makeDeps();
      const reporter = new FleetReporter(
        makeConfig(), issues, fleetCheckpoint as any, fleetProgress as any, tokenTracker as any, logger as any,
      );

      const results: PromiseSettledResult<IssueResult>[] = [
        { status: 'rejected', reason: new Error('Unexpected crash') },
      ];

      const result = reporter.aggregateResults(results, Date.now());

      expect(result.success).toBe(false);
      expect(result.failedIssues).toHaveLength(1);
      expect(result.failedIssues[0].issueNumber).toBe(0);
      expect(result.failedIssues[0].error).toContain('Unexpected crash');
    });

    it('should use "Unknown error" when a failed result has no error string', () => {
      const issues = [makeIssue(1)];
      const { fleetCheckpoint, fleetProgress, tokenTracker, logger } = makeDeps();
      const reporter = new FleetReporter(
        makeConfig(), issues, fleetCheckpoint as any, fleetProgress as any, tokenTracker as any, logger as any,
      );

      const results: PromiseSettledResult<IssueResult>[] = [
        {
          status: 'fulfilled',
          value: {
            issueNumber: 1, issueTitle: 'Issue 1', success: false,
            codeComplete: false, phases: [], totalDuration: 0, tokenUsage: 0,
          },
        },
      ];

      const result = reporter.aggregateResults(results, Date.now());
      expect(result.failedIssues[0].error).toBe('Unknown error');
    });

    it('should populate codeDoneNoPR for codeComplete but failed issues', () => {
      const issues = [makeIssue(1)];
      const { fleetCheckpoint, fleetProgress, tokenTracker, logger } = makeDeps();
      fleetCheckpoint.getIssueStatus.mockReturnValue({ branchName: 'cadre/issue-1' });
      const reporter = new FleetReporter(
        makeConfig(), issues, fleetCheckpoint as any, fleetProgress as any, tokenTracker as any, logger as any,
      );

      const results: PromiseSettledResult<IssueResult>[] = [
        {
          status: 'fulfilled',
          value: {
            issueNumber: 1, issueTitle: 'Issue 1', success: false,
            codeComplete: true, phases: [], totalDuration: 0, tokenUsage: 0,
            error: 'PR creation failed',
          },
        },
      ];

      const result = reporter.aggregateResults(results, Date.now());
      expect(result.codeDoneNoPR).toHaveLength(1);
      expect(result.codeDoneNoPR[0]).toEqual({ issueNumber: 1, branch: 'cadre/issue-1' });
    });

    it('should return empty branch string when checkpoint status is null', () => {
      const issues = [makeIssue(1)];
      const { fleetCheckpoint, fleetProgress, tokenTracker, logger } = makeDeps();
      fleetCheckpoint.getIssueStatus.mockReturnValue(null);
      const reporter = new FleetReporter(
        makeConfig(), issues, fleetCheckpoint as any, fleetProgress as any, tokenTracker as any, logger as any,
      );

      const results: PromiseSettledResult<IssueResult>[] = [
        {
          status: 'fulfilled',
          value: {
            issueNumber: 1, issueTitle: 'Issue 1', success: false,
            codeComplete: true, phases: [], totalDuration: 0, tokenUsage: 0,
            error: 'Failed',
          },
        },
      ];

      const result = reporter.aggregateResults(results, Date.now());
      expect(result.codeDoneNoPR[0].branch).toBe('');
    });

    it('should include tokenUsage from tokenTracker summary', () => {
      const issues: IssueDetail[] = [];
      const { fleetCheckpoint, fleetProgress, tokenTracker, logger } = makeDeps();
      const reporter = new FleetReporter(
        makeConfig(), issues, fleetCheckpoint as any, fleetProgress as any, tokenTracker as any, logger as any,
      );

      const result = reporter.aggregateResults([], Date.now());
      expect(result.tokenUsage.total).toBe(5000);
      expect(result.tokenUsage.recordCount).toBe(2);
    });
  });

  describe('writeFleetProgress', () => {
    it('should call fleetProgress.write with issue infos and PR refs', async () => {
      const issues = [makeIssue(1)];
      const { fleetCheckpoint, fleetProgress, tokenTracker, logger } = makeDeps();
      fleetCheckpoint.getIssueStatus.mockReturnValue({ status: 'completed', lastPhase: 5, branchName: 'cadre/issue-1' });
      const reporter = new FleetReporter(
        makeConfig(), issues, fleetCheckpoint as any, fleetProgress as any, tokenTracker as any, logger as any,
      );

      const fleetResult: FleetResult = {
        success: true,
        issues: [{
          issueNumber: 1, issueTitle: 'Issue 1', success: true, codeComplete: true,
          phases: [], totalDuration: 100, tokenUsage: 1000,
          pr: { number: 10, url: 'https://github.com/pull/10', title: 'PR', branch: 'cadre/issue-1' },
        }],
        prsCreated: [],
        failedIssues: [],
        codeDoneNoPR: [],
        totalDuration: 1000,
        tokenUsage: { total: 1000, byIssue: {}, byAgent: {}, byPhase: {}, recordCount: 1 },
      };

      await reporter.writeFleetProgress(fleetResult);

      expect(fleetProgress.write).toHaveBeenCalledTimes(1);
      const [issueInfos, prRefs, budget] = fleetProgress.write.mock.calls[0];
      expect(issueInfos).toHaveLength(1);
      expect(issueInfos[0].issueNumber).toBe(1);
      expect(issueInfos[0].status).toBe('completed');
      expect(prRefs).toHaveLength(1);
      expect(prRefs[0].prNumber).toBe(10);
      expect(budget).toEqual({ current: 5000, budget: 100000 });
    });

    it('should use defaults when checkpoint returns null', async () => {
      const issues = [makeIssue(1)];
      const { fleetCheckpoint, fleetProgress, tokenTracker, logger } = makeDeps();
      fleetCheckpoint.getIssueStatus.mockReturnValue(null);
      const reporter = new FleetReporter(
        makeConfig(), issues, fleetCheckpoint as any, fleetProgress as any, tokenTracker as any, logger as any,
      );

      const fleetResult: FleetResult = {
        success: true, issues: [], prsCreated: [], failedIssues: [], codeDoneNoPR: [],
        totalDuration: 0, tokenUsage: { total: 0, byIssue: {}, byAgent: {}, byPhase: {}, recordCount: 0 },
      };

      await reporter.writeFleetProgress(fleetResult);

      const [issueInfos] = fleetProgress.write.mock.calls[0];
      expect(issueInfos[0].status).toBe('not-started');
      expect(issueInfos[0].currentPhase).toBe(0);
    });
  });

  describe('writeFleetProgressIncremental', () => {
    it('should call fleetProgress.write with empty PR refs', async () => {
      const issues = [makeIssue(1)];
      const { fleetCheckpoint, fleetProgress, tokenTracker, logger } = makeDeps();
      fleetCheckpoint.getIssueStatus.mockReturnValue({ status: 'in-progress', lastPhase: 2, branchName: 'cadre/issue-1' });
      const reporter = new FleetReporter(
        makeConfig(), issues, fleetCheckpoint as any, fleetProgress as any, tokenTracker as any, logger as any,
      );

      await reporter.writeFleetProgressIncremental();

      expect(fleetProgress.write).toHaveBeenCalledTimes(1);
      const [issueInfos, prRefs] = fleetProgress.write.mock.calls[0];
      expect(issueInfos).toHaveLength(1);
      expect(issueInfos[0].status).toBe('in-progress');
      expect(issueInfos[0].currentPhase).toBe(2);
      expect(prRefs).toEqual([]);
    });
  });

  describe('writeReport', () => {
    it('should log success when report is written', async () => {
      const issues: IssueDetail[] = [];
      const { fleetCheckpoint, fleetProgress, tokenTracker, logger } = makeDeps();
      const reporter = new FleetReporter(
        makeConfig(), issues, fleetCheckpoint as any, fleetProgress as any, tokenTracker as any, logger as any,
      );

      const fleetResult: FleetResult = {
        success: true, issues: [], prsCreated: [], failedIssues: [], codeDoneNoPR: [],
        totalDuration: 0, tokenUsage: { total: 0, byIssue: {}, byAgent: {}, byPhase: {}, recordCount: 0 },
      };

      await reporter.writeReport(fleetResult, Date.now());
      expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('Run report written'));
    });

    it('should log a warning when report writing fails', async () => {
      const { ReportWriter } = await import('../src/reporting/report-writer.js');
      vi.mocked(ReportWriter).mockImplementationOnce(() => {
        throw new Error('disk full');
      });

      const issues: IssueDetail[] = [];
      const { fleetCheckpoint, fleetProgress, tokenTracker, logger } = makeDeps();
      const reporter = new FleetReporter(
        makeConfig(), issues, fleetCheckpoint as any, fleetProgress as any, tokenTracker as any, logger as any,
      );

      const fleetResult: FleetResult = {
        success: true, issues: [], prsCreated: [], failedIssues: [], codeDoneNoPR: [],
        totalDuration: 0, tokenUsage: { total: 0, byIssue: {}, byAgent: {}, byPhase: {}, recordCount: 0 },
      };

      await reporter.writeReport(fleetResult, Date.now());
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('Failed to write run report'));
    });
  });
});
