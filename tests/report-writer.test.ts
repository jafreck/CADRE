import { describe, it, expect, vi, beforeEach } from 'vitest';
import { join } from 'node:path';
import { ReportWriter } from '../src/reporting/report-writer.js';
import { CostEstimator } from '../src/budget/cost-estimator.js';
import { makeRuntimeConfig } from './helpers/make-runtime-config.js';
import type { RuntimeConfig } from '../src/config/loader.js';
import type { FleetResult } from '../src/core/fleet-orchestrator.js';
import type { IssueDetail } from '../src/platform/provider.js';
import type { RunReport } from '../src/reporting/types.js';
import { ISSUE_PHASES } from '../src/core/phase-registry.js';

vi.mock('../src/util/fs.js', () => ({
  atomicWriteJSON: vi.fn().mockResolvedValue(undefined),
  ensureDir: vi.fn().mockResolvedValue(undefined),
  readJSON: vi.fn(),
}));

vi.mock('node:fs/promises', () => ({
  readdir: vi.fn(),
}));

import * as fsUtil from '../src/util/fs.js';
import { readdir } from 'node:fs/promises';

const makeConfig = (overrides: Partial<RuntimeConfig> = {}) =>
  makeRuntimeConfig({
    repoPath: '/repo',
    copilot: {
      model: 'gpt-4o',
      cliCommand: 'copilot',
      agentDir: '.github/agents',
      timeout: 300000,
    },
    ...overrides,
  });

const makeFleetResult = (
  overrides: Partial<FleetResult> = {},
): FleetResult => ({
  success: true,
  issues: [
    {
      issueNumber: 1,
      issueTitle: 'Fix bug',
      success: true,
      phases: [],
      pr: { number: 10, url: 'https://github.com/owner/repo/pull/10' },
      totalDuration: 5000,
      tokenUsage: 1500,
    },
  ],
  prsCreated: [{ number: 10, url: 'https://github.com/owner/repo/pull/10' }],
  failedIssues: [],
  totalDuration: 5000,
  tokenUsage: {
    total: 1500,
    byIssue: { 1: 1500 },
    byAgent: {},
    byPhase: { 1: 500, 2: 300, 3: 700 },
  },
  ...overrides,
});

const makeIssues = (): IssueDetail[] => [
  { number: 1, title: 'Fix bug', body: '', labels: [], url: '' } as unknown as IssueDetail,
];

describe('ReportWriter', () => {
  let writer: ReportWriter;
  let config: ReturnType<typeof makeConfig>;
  let estimator: CostEstimator;

  beforeEach(() => {
    vi.clearAllMocks();
    config = makeConfig();
    estimator = new CostEstimator(config.copilot);
    writer = new ReportWriter(config, estimator);
  });

  describe('buildReport', () => {
    it('should return a RunReport with correct metadata', () => {
      const startTime = Date.now() - 3000;
      const result = makeFleetResult();
      const report = writer.buildReport(result, makeIssues(), startTime);

      expect(report.project).toBe('test-project');
      expect(report.runId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
      );
      expect(report.startTime).toBe(new Date(startTime).toISOString());
      expect(typeof report.endTime).toBe('string');
      expect(report.duration).toBeGreaterThan(0);
      expect(report.totalTokens).toBe(result.tokenUsage.total);
    });

    it('should map FleetResult.issues to RunIssueSummary array', () => {
      const result = makeFleetResult();
      const report = writer.buildReport(result, makeIssues(), Date.now() - 1000);

      expect(report.issues).toHaveLength(1);
      const issue = report.issues[0];
      expect(issue.issueNumber).toBe(1);
      expect(issue.issueTitle).toBe('Fix bug');
      expect(issue.success).toBe(true);
      expect(issue.prNumber).toBe(10);
      expect(issue.tokens).toBe(1500);
      expect(issue.duration).toBe(5000);
      expect(issue.error).toBeUndefined();
    });

    it('should map a failed issue with error field', () => {
      const result = makeFleetResult({
        issues: [
          {
            issueNumber: 2,
            issueTitle: 'Failing issue',
            success: false,
            phases: [],
            totalDuration: 1000,
            tokenUsage: 100,
            error: 'Agent timed out',
          },
        ],
        failedIssues: [{ issueNumber: 2, error: 'Agent timed out' }],
      });

      const report = writer.buildReport(result, makeIssues(), Date.now() - 1000);

      expect(report.issues[0].success).toBe(false);
      expect(report.issues[0].error).toBe('Agent timed out');
      expect(report.issues[0].prNumber).toBeUndefined();
    });

    it('should produce one RunPhaseSummary per ISSUE_PHASES entry', () => {
      const result = makeFleetResult();
      const report = writer.buildReport(result, makeIssues(), Date.now() - 1000);

      expect(report.phases).toHaveLength(ISSUE_PHASES.length);
      const firstPhase = report.phases[0];
      expect(firstPhase.id).toBe(String(ISSUE_PHASES[0].id));
      expect(firstPhase.name).toBe(ISSUE_PHASES[0].name);
      expect(firstPhase.tokens).toBe(500);
      expect(firstPhase.estimatedCost).toBeGreaterThanOrEqual(0);
    });

    it('should default missing byPhase entries to 0 tokens', () => {
      const result = makeFleetResult({
        tokenUsage: {
          total: 1500,
          byIssue: { 1: 1500 },
          byAgent: {},
          byPhase: {},
        },
      });
      const report = writer.buildReport(result, makeIssues(), Date.now() - 1000);

      for (const phase of report.phases) {
        expect(phase.tokens).toBe(0);
      }
    });

    it('should handle result with empty byPhase', () => {
      const result = makeFleetResult({
        tokenUsage: {
          total: 1000,
          byIssue: {},
          byAgent: {},
          byPhase: {},
        },
      });
      const report = writer.buildReport(result, makeIssues(), Date.now() - 1000);
      expect(report.phases).toHaveLength(ISSUE_PHASES.length);
      for (const phase of report.phases) {
        expect(phase.tokens).toBe(0);
      }
    });

    it('should populate totals correctly', () => {
      const result = makeFleetResult({
        issues: [
          {
            issueNumber: 1,
            issueTitle: 'Issue 1',
            success: true,
            phases: [],
            pr: { number: 10, url: '' },
            totalDuration: 1000,
            tokenUsage: 1000,
          },
          {
            issueNumber: 2,
            issueTitle: 'Issue 2',
            success: false,
            phases: [],
            totalDuration: 500,
            tokenUsage: 500,
            error: 'Timeout',
          },
        ],
        prsCreated: [{ number: 10, url: '' }],
        failedIssues: [{ issueNumber: 2, error: 'Timeout' }],
        tokenUsage: {
          total: 2000,
          byIssue: { 1: 1000, 2: 500 },
          byAgent: {},
          byPhase: {},
        },
      });

      const report = writer.buildReport(result, makeIssues(), Date.now() - 2000);

      expect(report.totals.issues).toBe(2);
      expect(report.totals.prsCreated).toBe(1);
      expect(report.totals.failures).toBe(1);
      expect(report.totals.tokens).toBe(2000);
      expect(report.totals.estimatedCost).toBeGreaterThanOrEqual(0);
    });

    it('should not include agentInvocations or retries fields', () => {
      const report = writer.buildReport(makeFleetResult(), makeIssues(), Date.now() - 1000);
      expect((report as Record<string, unknown>).agentInvocations).toBeUndefined();
      expect((report as Record<string, unknown>).retries).toBeUndefined();
    });

    it('should set prsCreated count from prsCreated array length', () => {
      const result = makeFleetResult({
        prsCreated: [
          { number: 1, url: '' },
          { number: 2, url: '' },
        ],
      });
      const report = writer.buildReport(result, makeIssues(), Date.now() - 1000);
      expect(report.prsCreated).toBe(2);
    });
  });

  describe('write', () => {
    it('should call ensureDir and atomicWriteJSON with correct paths', async () => {
      const report: RunReport = {
        runId: 'test-run-id',
        project: 'test-project',
        startTime: '2024-01-15T10:30:00.000Z',
        endTime: '2024-01-15T10:35:00.000Z',
        duration: 300000,
        issues: [],
        phases: [],
        totalTokens: 0,
        estimatedCost: 0,
        prsCreated: 0,
        totals: { tokens: 0, estimatedCost: 0, issues: 0, prsCreated: 0, failures: 0 },
      };

      const filePath = await writer.write(report);

      const expectedDir = join('/tmp/.cadre/test-project', 'reports');
      expect(fsUtil.ensureDir).toHaveBeenCalledWith(expectedDir);
      expect(fsUtil.atomicWriteJSON).toHaveBeenCalledWith(filePath, report);
    });

    it('should use ISO timestamp from report.startTime in the filename', async () => {
      const report: RunReport = {
        runId: 'test-run-id',
        project: 'test-project',
        startTime: '2024-06-01T12:00:00.000Z',
        endTime: '2024-06-01T12:05:00.000Z',
        duration: 300000,
        issues: [],
        phases: [],
        totalTokens: 0,
        estimatedCost: 0,
        prsCreated: 0,
        totals: { tokens: 0, estimatedCost: 0, issues: 0, prsCreated: 0, failures: 0 },
      };

      const filePath = await writer.write(report);

      expect(filePath).toContain('run-report-');
      expect(filePath).toContain('.json');
      // colons and dots are replaced with dashes
      expect(filePath).not.toContain(':');
    });

    it('should return the full path of the written file', async () => {
      const report: RunReport = {
        runId: 'run-1',
        project: 'p',
        startTime: '2024-01-01T00:00:00.000Z',
        endTime: '2024-01-01T00:01:00.000Z',
        duration: 60000,
        issues: [],
        phases: [],
        totalTokens: 0,
        estimatedCost: 0,
        prsCreated: 0,
        totals: { tokens: 0, estimatedCost: 0, issues: 0, prsCreated: 0, failures: 0 },
      };

      const filePath = await writer.write(report);
      expect(filePath).toContain(join('/tmp/.cadre/test-project', 'reports'));
    });
  });

  describe('listReports (static)', () => {
    it('should return sorted paths of run-report-*.json files', async () => {
      vi.mocked(readdir).mockResolvedValue([
        'run-report-2024-01-02T00-00-00-000Z.json',
        'run-report-2024-01-01T00-00-00-000Z.json',
        'run-report-2024-01-03T00-00-00-000Z.json',
        'other-file.txt',
      ] as unknown as Awaited<ReturnType<typeof readdir>>);

      const cadreDir = '/repo/.cadre';
      const result = await ReportWriter.listReports(cadreDir);

      expect(result).toHaveLength(3);
      expect(result[0]).toContain('2024-01-01');
      expect(result[1]).toContain('2024-01-02');
      expect(result[2]).toContain('2024-01-03');
    });

    it('should return empty array when reports directory does not exist', async () => {
      vi.mocked(readdir).mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));

      const result = await ReportWriter.listReports('/nonexistent/.cadre');
      expect(result).toEqual([]);
    });

    it('should exclude non-run-report files', async () => {
      vi.mocked(readdir).mockResolvedValue([
        'run-report-2024-01-01T00-00-00-000Z.json',
        'progress.json',
        'checkpoint.json',
        'run-report-2024-01-02T00-00-00-000Z.json',
      ] as unknown as Awaited<ReturnType<typeof readdir>>);

      const result = await ReportWriter.listReports('/repo/.cadre');
      expect(result).toHaveLength(2);
    });

    it('should return empty array when no run-report files exist', async () => {
      vi.mocked(readdir).mockResolvedValue(
        [] as unknown as Awaited<ReturnType<typeof readdir>>,
      );

      const result = await ReportWriter.listReports('/repo/.cadre');
      expect(result).toEqual([]);
    });

    it('should include the reports subdirectory in each returned path', async () => {
      vi.mocked(readdir).mockResolvedValue([
        'run-report-2024-01-01T00-00-00-000Z.json',
      ] as unknown as Awaited<ReturnType<typeof readdir>>);

      const result = await ReportWriter.listReports('/repo/.cadre');
      expect(result[0]).toContain(join('/repo/.cadre', 'reports'));
    });
  });

  describe('readReport (static)', () => {
    it('should return parsed RunReport from file', async () => {
      const fakeReport: RunReport = {
        runId: 'r1',
        project: 'my-project',
        startTime: '2024-01-01T00:00:00.000Z',
        endTime: '2024-01-01T01:00:00.000Z',
        duration: 3600000,
        issues: [],
        phases: [],
        totalTokens: 100,
        estimatedCost: 0.01,
        prsCreated: 0,
        totals: { tokens: 100, estimatedCost: 0.01, issues: 0, prsCreated: 0, failures: 0 },
      };

      vi.mocked(fsUtil.readJSON).mockResolvedValue(fakeReport);

      const result = await ReportWriter.readReport('/repo/.cadre/reports/run-report-x.json');

      expect(fsUtil.readJSON).toHaveBeenCalledWith('/repo/.cadre/reports/run-report-x.json');
      expect(result).toEqual(fakeReport);
    });

    it('should propagate errors from readJSON', async () => {
      vi.mocked(fsUtil.readJSON).mockRejectedValue(new Error('File not found'));

      await expect(ReportWriter.readReport('/nonexistent.json')).rejects.toThrow('File not found');
    });
  });

  describe('buildReport with waveMap', () => {
    it('should include wave number in RunIssueSummary when waveMap is provided', () => {
      const result = makeFleetResult();
      const waveMap = new Map([[1, 0]]);
      const report = writer.buildReport(result, makeIssues(), Date.now() - 1000, waveMap);

      expect(report.issues[0].wave).toBe(0);
    });

    it('should not include wave when waveMap is not provided', () => {
      const result = makeFleetResult();
      const report = writer.buildReport(result, makeIssues(), Date.now() - 1000);

      expect(report.issues[0].wave).toBeUndefined();
    });

    it('should not include wave when issue is not in waveMap', () => {
      const result = makeFleetResult();
      const waveMap = new Map([[99, 0]]); // issue 1 not in map
      const report = writer.buildReport(result, makeIssues(), Date.now() - 1000, waveMap);

      expect(report.issues[0].wave).toBeUndefined();
    });

    it('should include correct wave for each issue in a multi-issue run', () => {
      const result = makeFleetResult({
        issues: [
          { issueNumber: 1, issueTitle: 'First', success: true, phases: [], totalDuration: 100, tokenUsage: 100 },
          { issueNumber: 2, issueTitle: 'Second', success: true, phases: [], totalDuration: 100, tokenUsage: 100 },
        ],
      });
      const waveMap = new Map([[1, 0], [2, 1]]);
      const report = writer.buildReport(result, makeIssues(), Date.now() - 1000, waveMap);

      expect(report.issues[0].wave).toBe(0);
      expect(report.issues[1].wave).toBe(1);
    });
  });

  describe('formatIssueEntry (static)', () => {
    it('should include "Wave N" prefix when wave is present', () => {
      const issue = { issueNumber: 1, issueTitle: 'Fix bug', success: true, tokens: 0, duration: 0, wave: 2 };
      const line = ReportWriter.formatIssueEntry(issue);
      expect(line).toContain('Wave 2');
    });

    it('should not include Wave prefix when wave is absent', () => {
      const issue = { issueNumber: 1, issueTitle: 'Fix bug', success: true, tokens: 0, duration: 0 };
      const line = ReportWriter.formatIssueEntry(issue);
      expect(line).not.toContain('Wave');
    });

    it('should show success indicator for successful non-DAG issue', () => {
      const issue = { issueNumber: 1, issueTitle: 'Fix bug', success: true, tokens: 0, duration: 0 };
      const line = ReportWriter.formatIssueEntry(issue);
      expect(line).toContain('✓');
      expect(line).not.toContain('FAILED');
    });

    it('should show FAILED for unsuccessful non-DAG issue', () => {
      const issue = { issueNumber: 2, issueTitle: 'Broken', success: false, tokens: 0, duration: 0, error: 'Timeout' };
      const line = ReportWriter.formatIssueEntry(issue);
      expect(line).toContain('FAILED');
      expect(line).toContain('Timeout');
    });

    it('should display dep-blocked with ⊘ label', () => {
      const issue = { issueNumber: 3, issueTitle: 'Blocked', success: false, tokens: 0, duration: 0, error: 'dep-blocked' };
      const line = ReportWriter.formatIssueEntry(issue);
      expect(line).toContain('⊘ dep-blocked');
      expect(line).not.toContain('FAILED');
    });

    it('should display dep-failed with descriptive label', () => {
      const issue = { issueNumber: 4, issueTitle: 'Dep failed', success: false, tokens: 0, duration: 0, error: 'dep-failed' };
      const line = ReportWriter.formatIssueEntry(issue);
      expect(line).toContain('dep-failed');
      expect(line).not.toContain('FAILED');
    });

    it('should display dep-merge-conflict with descriptive label', () => {
      const issue = { issueNumber: 5, issueTitle: 'Conflict', success: false, tokens: 0, duration: 0, error: 'dep-merge-conflict' };
      const line = ReportWriter.formatIssueEntry(issue);
      expect(line).toContain('dep-merge-conflict');
      expect(line).not.toContain('FAILED');
    });

    it('should display dep-build-broken with descriptive label', () => {
      const issue = { issueNumber: 6, issueTitle: 'Build broken', success: false, tokens: 0, duration: 0, error: 'dep-build-broken' };
      const line = ReportWriter.formatIssueEntry(issue);
      expect(line).toContain('dep-build-broken');
      expect(line).not.toContain('FAILED');
    });

    it('should combine Wave prefix with DAG status label', () => {
      const issue = { issueNumber: 7, issueTitle: 'Blocked', success: false, tokens: 0, duration: 0, wave: 1, error: 'dep-blocked' };
      const line = ReportWriter.formatIssueEntry(issue);
      expect(line).toContain('Wave 1');
      expect(line).toContain('⊘ dep-blocked');
    });

    it('should include issue number and title in the line', () => {
      const issue = { issueNumber: 42, issueTitle: 'My feature', success: true, tokens: 0, duration: 0 };
      const line = ReportWriter.formatIssueEntry(issue);
      expect(line).toContain('#42');
      expect(line).toContain('My feature');
    });
  });
});
