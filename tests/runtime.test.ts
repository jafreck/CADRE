import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { CadreRuntime } from '../src/core/runtime.js';
import type { CadreConfig } from '../src/config/schema.js';
import type { RunReport } from '../src/reporting/types.js';

// Mock Logger to avoid file system access
vi.mock('../src/logging/logger.js', () => ({
  Logger: vi.fn().mockImplementation(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    child: vi.fn().mockReturnThis(),
  })),
}));

// Mock platform factory to avoid real provider setup
vi.mock('../src/platform/factory.js', () => ({
  createPlatformProvider: vi.fn().mockReturnValue({
    name: 'mock',
    connect: vi.fn(),
    disconnect: vi.fn(),
    checkAuth: vi.fn().mockResolvedValue(true),
    getIssue: vi.fn(),
    listIssues: vi.fn(),
    createPullRequest: vi.fn(),
    getPullRequest: vi.fn(),
  }),
}));

// Mock ReportWriter static methods
vi.mock('../src/reporting/report-writer.js', () => ({
  ReportWriter: {
    listReports: vi.fn(),
    readReport: vi.fn(),
  },
}));

// Mock CostEstimator
vi.mock('../src/budget/cost-estimator.js', () => ({
  CostEstimator: vi.fn().mockImplementation(() => ({
    estimate: vi.fn().mockReturnValue({ totalCost: 0.12 }),
    format: vi.fn().mockReturnValue('$0.12'),
  })),
}));

import { ReportWriter } from '../src/reporting/report-writer.js';

const makeConfig = (): CadreConfig =>
  ({
    projectName: 'test-project',
    repoPath: '/repo',
    repository: 'owner/repo',
    baseBranch: 'main',
    copilot: {
      model: 'gpt-4o',
      cliCommand: 'copilot',
      agentDir: '.github/agents',
      timeout: 300000,
    },
    options: {
      maxParallelIssues: 1,
      tokenBudget: 100000,
      resume: false,
    },
    issues: { ids: [] },
    platform: { type: 'github' },
  }) as unknown as CadreConfig;

const makeFakeReport = (overrides: Partial<RunReport> = {}): RunReport => ({
  runId: 'abc-123',
  project: 'test-project',
  startTime: '2024-01-15T10:30:00.000Z',
  endTime: '2024-01-15T10:35:00.000Z',
  duration: 300000,
  issues: [],
  phases: [],
  totalTokens: 5000,
  estimatedCost: 0.1,
  prsCreated: 2,
  agentInvocations: 0,
  retries: 0,
  totals: { tokens: 5000, estimatedCost: 0.1, issues: 3, prsCreated: 2, failures: 1 },
  ...overrides,
});

describe('CadreRuntime.report()', () => {
  let runtime: CadreRuntime;
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    runtime = new CadreRuntime(makeConfig());
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  describe('when no reports exist', () => {
    beforeEach(() => {
      vi.mocked(ReportWriter.listReports).mockResolvedValue([]);
    });

    it('should print "No reports found." when called with no options', async () => {
      await runtime.report({});
      expect(consoleSpy).toHaveBeenCalledWith('No reports found.');
    });

    it('should print "No reports found." when history is true', async () => {
      await runtime.report({ history: true });
      expect(consoleSpy).toHaveBeenCalledWith('No reports found.');
    });

    it('should not call readReport when no reports exist', async () => {
      await runtime.report({});
      expect(ReportWriter.readReport).not.toHaveBeenCalled();
    });
  });

  describe('report({ history: true })', () => {
    it('should list all report paths, one per line', async () => {
      const paths = [
        '/repo/.cadre/reports/run-report-2024-01-01.json',
        '/repo/.cadre/reports/run-report-2024-01-02.json',
      ];
      vi.mocked(ReportWriter.listReports).mockResolvedValue(paths);

      await runtime.report({ history: true });

      expect(consoleSpy).toHaveBeenCalledWith(paths[0]);
      expect(consoleSpy).toHaveBeenCalledWith(paths[1]);
    });

    it('should not call readReport when history is true', async () => {
      vi.mocked(ReportWriter.listReports).mockResolvedValue([
        '/repo/.cadre/reports/run-report-2024-01-01.json',
      ]);

      await runtime.report({ history: true });

      expect(ReportWriter.readReport).not.toHaveBeenCalled();
    });

    it('should call listReports with the correct cadreDir', async () => {
      vi.mocked(ReportWriter.listReports).mockResolvedValue([
        '/repo/.cadre/reports/run-report-2024-01-01.json',
      ]);

      await runtime.report({ history: true });

      expect(ReportWriter.listReports).toHaveBeenCalledWith('/repo/.cadre');
    });
  });

  describe('report({ format: "json" })', () => {
    it('should print raw JSON of the most recent report', async () => {
      const paths = [
        '/repo/.cadre/reports/run-report-2024-01-01.json',
        '/repo/.cadre/reports/run-report-2024-01-02.json',
      ];
      const fakeReport = makeFakeReport();
      vi.mocked(ReportWriter.listReports).mockResolvedValue(paths);
      vi.mocked(ReportWriter.readReport).mockResolvedValue(fakeReport);

      await runtime.report({ format: 'json' });

      expect(ReportWriter.readReport).toHaveBeenCalledWith(paths[paths.length - 1]);
      expect(consoleSpy).toHaveBeenCalledWith(JSON.stringify(fakeReport));
    });

    it('should use the last path in the list as the most recent report', async () => {
      const paths = [
        '/repo/.cadre/reports/run-report-2024-01-01.json',
        '/repo/.cadre/reports/run-report-2024-01-03.json',
        '/repo/.cadre/reports/run-report-2024-01-02.json',
      ];
      const fakeReport = makeFakeReport();
      vi.mocked(ReportWriter.listReports).mockResolvedValue(paths);
      vi.mocked(ReportWriter.readReport).mockResolvedValue(fakeReport);

      await runtime.report({ format: 'json' });

      expect(ReportWriter.readReport).toHaveBeenCalledWith('/repo/.cadre/reports/run-report-2024-01-02.json');
    });
  });

  describe('report({}) — formatted summary', () => {
    it('should print a formatted report header', async () => {
      const fakeReport = makeFakeReport();
      vi.mocked(ReportWriter.listReports).mockResolvedValue([
        '/repo/.cadre/reports/run-report-2024-01-01.json',
      ]);
      vi.mocked(ReportWriter.readReport).mockResolvedValue(fakeReport);

      await runtime.report({});

      const allOutput = consoleSpy.mock.calls.flat().join('\n');
      expect(allOutput).toContain('CADRE Run Report');
    });

    it('should include run ID in formatted output', async () => {
      const fakeReport = makeFakeReport({ runId: 'unique-run-id-xyz' });
      vi.mocked(ReportWriter.listReports).mockResolvedValue([
        '/repo/.cadre/reports/run-report-2024-01-01.json',
      ]);
      vi.mocked(ReportWriter.readReport).mockResolvedValue(fakeReport);

      await runtime.report({});

      const allOutput = consoleSpy.mock.calls.flat().join('\n');
      expect(allOutput).toContain('unique-run-id-xyz');
    });

    it('should include project name in formatted output', async () => {
      const fakeReport = makeFakeReport({ project: 'test-project' });
      vi.mocked(ReportWriter.listReports).mockResolvedValue([
        '/repo/.cadre/reports/run-report-2024-01-01.json',
      ]);
      vi.mocked(ReportWriter.readReport).mockResolvedValue(fakeReport);

      await runtime.report({});

      const allOutput = consoleSpy.mock.calls.flat().join('\n');
      expect(allOutput).toContain('test-project');
    });

    it('should include duration, issues, PRs, failures, tokens, and cost in output', async () => {
      const fakeReport = makeFakeReport({
        duration: 5000,
        totalTokens: 8000,
        totals: { tokens: 8000, estimatedCost: 0.12, issues: 4, prsCreated: 2, failures: 1 },
      });
      vi.mocked(ReportWriter.listReports).mockResolvedValue([
        '/repo/.cadre/reports/run-report-2024-01-01.json',
      ]);
      vi.mocked(ReportWriter.readReport).mockResolvedValue(fakeReport);

      await runtime.report({});

      const allOutput = consoleSpy.mock.calls.flat().join('\n');
      expect(allOutput).toContain('5.0s');
      expect(allOutput).toContain('4'); // issues
      expect(allOutput).toContain('2'); // PRs
      expect(allOutput).toContain('1'); // failures
      expect(allOutput).toContain('$0.12'); // formatted cost from mock
    });

    it('should read the most recent report (last in sorted list)', async () => {
      const paths = [
        '/repo/.cadre/reports/run-report-2024-01-01.json',
        '/repo/.cadre/reports/run-report-2024-01-02.json',
      ];
      const fakeReport = makeFakeReport();
      vi.mocked(ReportWriter.listReports).mockResolvedValue(paths);
      vi.mocked(ReportWriter.readReport).mockResolvedValue(fakeReport);

      await runtime.report({});

      expect(ReportWriter.readReport).toHaveBeenCalledWith('/repo/.cadre/reports/run-report-2024-01-02.json');
    });
  });

  describe('default parameter behavior', () => {
    it('should work with no arguments (defaults to {})', async () => {
      const fakeReport = makeFakeReport();
      vi.mocked(ReportWriter.listReports).mockResolvedValue([
        '/repo/.cadre/reports/run-report-2024-01-01.json',
      ]);
      vi.mocked(ReportWriter.readReport).mockResolvedValue(fakeReport);

      await runtime.report();

      const allOutput = consoleSpy.mock.calls.flat().join('\n');
      expect(allOutput).toContain('CADRE Run Report');
    });
  });
});
