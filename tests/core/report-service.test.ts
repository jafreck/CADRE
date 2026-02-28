import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../src/reporting/report-writer.js', () => ({
  ReportWriter: {
    listReports: vi.fn(),
    readReport: vi.fn(),
  },
}));

vi.mock('../../src/budget/cost-estimator.js', () => ({
  CostEstimator: vi.fn().mockImplementation(() => ({
    estimate: vi.fn().mockReturnValue({ totalCost: 0.05 }),
    format: vi.fn().mockReturnValue('$0.05'),
  })),
}));

import { ReportService } from '../../src/core/report-service.js';
import { ReportWriter } from '../../src/reporting/report-writer.js';
import { CostEstimator } from '../../src/budget/cost-estimator.js';
import type { RuntimeConfig } from '../../src/config/loader.js';

const mockListReports = ReportWriter.listReports as ReturnType<typeof vi.fn>;
const mockReadReport = ReportWriter.readReport as ReturnType<typeof vi.fn>;
const MockCostEstimator = CostEstimator as unknown as ReturnType<typeof vi.fn>;

function makeConfig(): RuntimeConfig {
  return {
    stateDir: '/tmp/cadre-state',
    projectName: 'test-project',
    agent: {
      backend: 'copilot',
      model: 'claude-sonnet-4.6',
      timeout: 300000,
      copilot: { cliCommand: 'copilot', agentDir: '.agents' },
      claude: { cliCommand: 'claude', agentDir: '.agents' },
    },
  } as unknown as RuntimeConfig;
}

function makeLogger() {
  return {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    child: vi.fn().mockReturnThis(),
  } as any;
}

const sampleRun = {
  runId: 'run-123',
  project: 'test-project',
  duration: 5000,
  totals: { issues: 3, prsCreated: 2, failures: 1 },
  totalTokens: 50000,
};

describe('ReportService', () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  describe('report() — no reports found', () => {
    beforeEach(() => {
      mockListReports.mockResolvedValue([]);
    });

    it('should print "No reports found." when there are no reports', async () => {
      const service = new ReportService(makeConfig(), makeLogger());
      await service.report();

      expect(consoleSpy).toHaveBeenCalledWith('No reports found.');
    });

    it('should print "No reports found." when history is requested but none exist', async () => {
      const service = new ReportService(makeConfig(), makeLogger());
      await service.report({ history: true });

      expect(consoleSpy).toHaveBeenCalledWith('No reports found.');
    });
  });

  describe('report() — history mode', () => {
    it('should print each report path when history is requested', async () => {
      mockListReports.mockResolvedValue(['/reports/run-1.json', '/reports/run-2.json']);

      const service = new ReportService(makeConfig(), makeLogger());
      await service.report({ history: true });

      expect(consoleSpy).toHaveBeenCalledWith('/reports/run-1.json');
      expect(consoleSpy).toHaveBeenCalledWith('/reports/run-2.json');
    });

    it('should not read report contents in history mode', async () => {
      mockListReports.mockResolvedValue(['/reports/run-1.json']);

      const service = new ReportService(makeConfig(), makeLogger());
      await service.report({ history: true });

      expect(mockReadReport).not.toHaveBeenCalled();
    });
  });

  describe('report() — JSON format', () => {
    it('should print raw JSON of the most recent report', async () => {
      mockListReports.mockResolvedValue(['/reports/run-123.json']);
      mockReadReport.mockResolvedValue(sampleRun);

      const service = new ReportService(makeConfig(), makeLogger());
      await service.report({ format: 'json' });

      expect(consoleSpy).toHaveBeenCalledWith(JSON.stringify(sampleRun));
    });

    it('should read the last report in the list', async () => {
      mockListReports.mockResolvedValue(['/reports/old.json', '/reports/new.json']);
      mockReadReport.mockResolvedValue(sampleRun);

      const service = new ReportService(makeConfig(), makeLogger());
      await service.report({ format: 'json' });

      expect(mockReadReport).toHaveBeenCalledWith('/reports/new.json');
    });
  });

  describe('report() — human-readable format (default)', () => {
    beforeEach(() => {
      mockListReports.mockResolvedValue(['/reports/run-123.json']);
      mockReadReport.mockResolvedValue(sampleRun);
    });

    it('should print the run header', async () => {
      const service = new ReportService(makeConfig(), makeLogger());
      await service.report();

      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('CADRE Run Report'));
    });

    it('should print the run ID', async () => {
      const service = new ReportService(makeConfig(), makeLogger());
      await service.report();

      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('run-123'));
    });

    it('should print the project name', async () => {
      const service = new ReportService(makeConfig(), makeLogger());
      await service.report();

      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('test-project'));
    });

    it('should print duration in seconds', async () => {
      const service = new ReportService(makeConfig(), makeLogger());
      await service.report();

      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('5.0s'));
    });

    it('should print issue count', async () => {
      const service = new ReportService(makeConfig(), makeLogger());
      await service.report();

      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('3'));
    });

    it('should use CostEstimator to format cost', async () => {
      const service = new ReportService(makeConfig(), makeLogger());
      await service.report();

      expect(MockCostEstimator).toHaveBeenCalled();
      expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('$0.05'));
    });
  });
});
