import { describe, it, expect, vi, beforeEach } from 'vitest';
import { FleetScheduler, type ProcessIssueFn, type MarkDepBlockedFn } from '../src/core/fleet-scheduler.js';
import type { IssueDetail } from '../src/platform/provider.js';
import type { IssueResult } from '../src/core/issue-orchestrator.js';
import type { IssueDag } from '../src/core/issue-dag.js';

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

function makeResult(issueNumber: number, success = true): IssueResult {
  return {
    issueNumber,
    issueTitle: `Issue ${issueNumber}`,
    success,
    codeComplete: success,
    phases: [],
    totalDuration: 100,
    tokenUsage: 500,
  };
}

function makeConfig(overrides: Record<string, unknown> = {}) {
  return {
    options: { maxParallelIssues: 3, resume: false, ...overrides },
    dag: undefined,
    baseBranch: 'main',
  } as any;
}

function makeDeps() {
  const fleetCheckpoint = {
    setDag: vi.fn().mockResolvedValue(undefined),
    isIssueCompleted: vi.fn().mockReturnValue(false),
    getIssueStatus: vi.fn().mockReturnValue(null),
    setIssueStatus: vi.fn().mockResolvedValue(undefined),
  };
  const platform = {
    mergePullRequest: vi.fn().mockResolvedValue(undefined),
  };
  const logger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };
  return { fleetCheckpoint, platform, logger };
}

describe('FleetScheduler', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('schedule (non-DAG)', () => {
    it('should process all issues with bounded parallelism', async () => {
      const issues = [makeIssue(1), makeIssue(2), makeIssue(3)];
      const { fleetCheckpoint, platform, logger } = makeDeps();
      const scheduler = new FleetScheduler(
        makeConfig(), issues, fleetCheckpoint as any, platform as any, logger as any,
      );

      const processIssue: ProcessIssueFn = vi.fn().mockImplementation((issue) =>
        Promise.resolve(makeResult(issue.number)),
      );
      const markDepBlocked: MarkDepBlockedFn = vi.fn();

      const results = await scheduler.schedule(issues, processIssue, markDepBlocked);

      expect(results).toHaveLength(3);
      expect(results.every((r) => r.status === 'fulfilled')).toBe(true);
      expect(processIssue).toHaveBeenCalledTimes(3);
      expect(markDepBlocked).not.toHaveBeenCalled();
    });

    it('should handle processIssue rejections as rejected settlements', async () => {
      const issues = [makeIssue(1)];
      const { fleetCheckpoint, platform, logger } = makeDeps();
      const scheduler = new FleetScheduler(
        makeConfig(), issues, fleetCheckpoint as any, platform as any, logger as any,
      );

      const processIssue: ProcessIssueFn = vi.fn().mockRejectedValue(new Error('Crash'));
      const markDepBlocked: MarkDepBlockedFn = vi.fn();

      const results = await scheduler.schedule(issues, processIssue, markDepBlocked);

      expect(results).toHaveLength(1);
      expect(results[0].status).toBe('rejected');
    });

    it('should not invoke DAG logic when dag is undefined', async () => {
      const issues = [makeIssue(1)];
      const { fleetCheckpoint, platform, logger } = makeDeps();
      const scheduler = new FleetScheduler(
        makeConfig(), issues, fleetCheckpoint as any, platform as any, logger as any,
      );

      const processIssue: ProcessIssueFn = vi.fn().mockResolvedValue(makeResult(1));
      const markDepBlocked: MarkDepBlockedFn = vi.fn();

      await scheduler.schedule(issues, processIssue, markDepBlocked, undefined);

      expect(fleetCheckpoint.setDag).not.toHaveBeenCalled();
    });
  });

  describe('schedule (DAG)', () => {
    it('should process issues in wave order respecting dependencies', async () => {
      const issue1 = makeIssue(1);
      const issue2 = makeIssue(2);
      const issues = [issue1, issue2];
      const { fleetCheckpoint, platform, logger } = makeDeps();
      const scheduler = new FleetScheduler(
        makeConfig(), issues, fleetCheckpoint as any, platform as any, logger as any,
        { 2: [1] },
      );

      const processOrder: number[] = [];
      const processIssue: ProcessIssueFn = vi.fn().mockImplementation(async (issue) => {
        processOrder.push(issue.number);
        return makeResult(issue.number);
      });
      const markDepBlocked: MarkDepBlockedFn = vi.fn();

      const dag = {
        getWaves: () => [[issue1], [issue2]],
        getDirectDeps: vi.fn().mockImplementation((num: number) => (num === 2 ? [1] : [])),
        getTransitiveDepsOrdered: vi.fn().mockReturnValue([]),
      } as unknown as IssueDag;

      const results = await scheduler.schedule(issues, processIssue, markDepBlocked, dag);

      expect(results).toHaveLength(2);
      expect(processOrder).toEqual([1, 2]);
      expect(fleetCheckpoint.setDag).toHaveBeenCalledTimes(1);
    });

    it('should mark downstream issues as dep-blocked when a dependency fails', async () => {
      const issue1 = makeIssue(1);
      const issue2 = makeIssue(2);
      const issues = [issue1, issue2];
      const { fleetCheckpoint, platform, logger } = makeDeps();
      const scheduler = new FleetScheduler(
        makeConfig(), issues, fleetCheckpoint as any, platform as any, logger as any,
        { 2: [1] },
      );

      const processIssue: ProcessIssueFn = vi.fn().mockImplementation(async (issue) => {
        if (issue.number === 1) {
          return { ...makeResult(1, false), success: false, error: 'Build failed' };
        }
        return makeResult(issue.number);
      });

      const markDepBlocked: MarkDepBlockedFn = vi.fn().mockImplementation(async (issue) => ({
        ...makeResult(issue.number, false),
        success: false,
        error: 'dep-blocked',
      }));

      const dag = {
        getWaves: () => [[issue1], [issue2]],
        getDirectDeps: vi.fn().mockImplementation((num: number) => (num === 2 ? [1] : [])),
        getTransitiveDepsOrdered: vi.fn().mockReturnValue([]),
      } as unknown as IssueDag;

      const results = await scheduler.schedule(issues, processIssue, markDepBlocked, dag);

      expect(results).toHaveLength(2);
      // Issue 1 was processed, issue 2 was dep-blocked
      expect(processIssue).toHaveBeenCalledTimes(1);
      expect(markDepBlocked).toHaveBeenCalledTimes(1);
    });

    it('should auto-merge PRs when dag.autoMerge is enabled', async () => {
      const issue1 = makeIssue(1);
      const issues = [issue1];
      const { fleetCheckpoint, platform, logger } = makeDeps();
      const config = makeConfig();
      config.dag = { autoMerge: true };
      const scheduler = new FleetScheduler(
        config, issues, fleetCheckpoint as any, platform as any, logger as any,
      );

      const processIssue: ProcessIssueFn = vi.fn().mockResolvedValue({
        ...makeResult(1),
        pr: { number: 10, url: 'https://github.com/pull/10', title: 'PR 10', branch: 'cadre/issue-1' },
      });
      const markDepBlocked: MarkDepBlockedFn = vi.fn();

      const dag = {
        getWaves: () => [[issue1]],
        getDirectDeps: vi.fn().mockReturnValue([]),
        getTransitiveDepsOrdered: vi.fn().mockReturnValue([]),
      } as unknown as IssueDag;

      await scheduler.schedule(issues, processIssue, markDepBlocked, dag);

      expect(platform.mergePullRequest).toHaveBeenCalledWith(10, 'main');
    });

    it('should mark issue as dep-merge-conflict when autoMerge fails', async () => {
      const issue1 = makeIssue(1);
      const issues = [issue1];
      const { fleetCheckpoint, platform, logger } = makeDeps();
      const config = makeConfig();
      config.dag = { autoMerge: true };
      platform.mergePullRequest.mockRejectedValue(new Error('Merge conflict'));
      const scheduler = new FleetScheduler(
        config, issues, fleetCheckpoint as any, platform as any, logger as any,
      );

      const processIssue: ProcessIssueFn = vi.fn().mockResolvedValue({
        ...makeResult(1),
        pr: { number: 10, url: 'https://github.com/pull/10', title: 'PR 10', branch: 'cadre/issue-1' },
      });
      const markDepBlocked: MarkDepBlockedFn = vi.fn();

      const dag = {
        getWaves: () => [[issue1]],
        getDirectDeps: vi.fn().mockReturnValue([]),
        getTransitiveDepsOrdered: vi.fn().mockReturnValue([]),
      } as unknown as IssueDag;

      const results = await scheduler.schedule(issues, processIssue, markDepBlocked, dag);

      expect(fleetCheckpoint.setIssueStatus).toHaveBeenCalledWith(
        1, 'dep-merge-conflict', '', '', 0, 'Issue 1', expect.stringContaining('Merge conflict'),
      );
      expect(results).toHaveLength(1);
    });

    it('should skip already-completed issues on resume', async () => {
      const issue1 = makeIssue(1);
      const issue2 = makeIssue(2);
      const issues = [issue1, issue2];
      const { fleetCheckpoint, platform, logger } = makeDeps();
      fleetCheckpoint.isIssueCompleted.mockImplementation((num: number) => num === 1);
      const config = makeConfig({ resume: true });
      const scheduler = new FleetScheduler(
        config, issues, fleetCheckpoint as any, platform as any, logger as any,
      );

      const processIssue: ProcessIssueFn = vi.fn().mockImplementation(async (issue) =>
        makeResult(issue.number),
      );
      const markDepBlocked: MarkDepBlockedFn = vi.fn();

      const dag = {
        getWaves: () => [[issue1], [issue2]],
        getDirectDeps: vi.fn().mockImplementation((num: number) => (num === 2 ? [1] : [])),
        getTransitiveDepsOrdered: vi.fn().mockReturnValue([]),
      } as unknown as IssueDag;

      const results = await scheduler.schedule(issues, processIssue, markDepBlocked, dag);

      // Issue 1 is already completed, only issue 2 should be processed
      expect(processIssue).toHaveBeenCalledTimes(1);
      expect(processIssue).toHaveBeenCalledWith(issue2, dag);
    });

    it('should handle processIssue throwing an error in DAG mode', async () => {
      const issue1 = makeIssue(1);
      const issues = [issue1];
      const { fleetCheckpoint, platform, logger } = makeDeps();
      const scheduler = new FleetScheduler(
        makeConfig(), issues, fleetCheckpoint as any, platform as any, logger as any,
      );

      const processIssue: ProcessIssueFn = vi.fn().mockRejectedValue(new Error('Unexpected'));
      const markDepBlocked: MarkDepBlockedFn = vi.fn();

      const dag = {
        getWaves: () => [[issue1]],
        getDirectDeps: vi.fn().mockReturnValue([]),
        getTransitiveDepsOrdered: vi.fn().mockReturnValue([]),
      } as unknown as IssueDag;

      const results = await scheduler.schedule(issues, processIssue, markDepBlocked, dag);

      expect(results).toHaveLength(1);
      expect(results[0].status).toBe('rejected');
    });
  });
});
