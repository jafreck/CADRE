import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ─── Module mocks (hoisted) ───────────────────────────────────────────────────

const mockReport = vi.fn().mockResolvedValue(undefined);
const mockReportServiceInstance = {
  report: mockReport,
};
const MockReportService = vi.fn().mockReturnValue(mockReportServiceInstance);

const mockConfig = {
  projectName: 'test-project',
  repoPath: '/repo',
  repository: 'owner/repo',
  baseBranch: 'main',
  stateDir: '/tmp/cadre-state',
  copilot: { model: 'gpt-4o', cliCommand: 'copilot', agentDir: '.agents', timeout: 300000 },
  options: { maxParallelIssues: 1, tokenBudget: 100000, resume: false },
  issues: { ids: [] },
  platform: { type: 'github' },
};

const mockLoadConfig = vi.fn().mockResolvedValue(mockConfig);
const mockApplyOverrides = vi.fn((c: unknown) => c);

vi.mock('../src/config/loader.js', () => ({
  loadConfig: mockLoadConfig,
  applyOverrides: mockApplyOverrides,
}));

vi.mock('../src/core/runtime.js', () => ({
  CadreRuntime: vi.fn().mockImplementation(() => ({
    run: vi.fn().mockResolvedValue({ success: true }),
  })),
}));

vi.mock('../src/core/report-service.js', () => ({
  ReportService: MockReportService,
}));

vi.mock('../src/logging/logger.js', () => ({
  Logger: vi.fn().mockImplementation(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    child: vi.fn().mockReturnThis(),
  })),
}));

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

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function runCli(args: string[]): Promise<void> {
  process.argv = ['node', 'cadre', ...args];
  vi.resetModules();
  await import('../src/index.js');
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('cadre report CLI command', () => {
  let originalArgv: string[];
  let exitSpy: ReturnType<typeof vi.spyOn>;
  let consoleSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    originalArgv = [...process.argv];
    vi.clearAllMocks();

    // Re-establish mock implementations after clearAllMocks
    mockLoadConfig.mockResolvedValue(mockConfig);
    mockApplyOverrides.mockImplementation((c: unknown) => c);
    mockReport.mockResolvedValue(undefined);
    MockReportService.mockReturnValue(mockReportServiceInstance);

    exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    process.argv = originalArgv;
    exitSpy.mockRestore();
    consoleSpy.mockRestore();
    consoleErrorSpy.mockRestore();
  });

  describe('option defaults', () => {
    it('should call runtime.report with format "human" by default', async () => {
      await runCli(['report']);
      expect(mockReport).toHaveBeenCalledWith(
        expect.objectContaining({ format: 'human' }),
      );
    });

    it('should call runtime.report with history undefined/falsy by default', async () => {
      await runCli(['report']);
      const call = mockReport.mock.calls[0][0];
      expect(call.history).toBeFalsy();
    });
  });

  describe('--format option', () => {
    it('should pass format "json" to runtime.report when --format json is given', async () => {
      await runCli(['report', '--format', 'json']);
      expect(mockReport).toHaveBeenCalledWith(
        expect.objectContaining({ format: 'json' }),
      );
    });

    it('should pass format "human" to runtime.report when --format human is given', async () => {
      await runCli(['report', '--format', 'human']);
      expect(mockReport).toHaveBeenCalledWith(
        expect.objectContaining({ format: 'human' }),
      );
    });

    it('should accept short flag -f for format', async () => {
      await runCli(['report', '-f', 'json']);
      expect(mockReport).toHaveBeenCalledWith(
        expect.objectContaining({ format: 'json' }),
      );
    });
  });

  describe('--history flag', () => {
    it('should pass history: true to runtime.report when --history is given', async () => {
      await runCli(['report', '--history']);
      expect(mockReport).toHaveBeenCalledWith(
        expect.objectContaining({ history: true }),
      );
    });

    it('should allow --history combined with --format json', async () => {
      await runCli(['report', '--history', '--format', 'json']);
      expect(mockReport).toHaveBeenCalledWith(
        expect.objectContaining({ history: true, format: 'json' }),
      );
    });
  });

  describe('config loading', () => {
    it('should load config from cadre.config.json by default', async () => {
      await runCli(['report']);
      expect(mockLoadConfig).toHaveBeenCalledWith('cadre.config.json');
    });

    it('should load config from custom path when -c is given', async () => {
      await runCli(['report', '-c', 'custom.config.json']);
      expect(mockLoadConfig).toHaveBeenCalledWith('custom.config.json');
    });

    it('should construct ReportService with the loaded config', async () => {
      await runCli(['report']);
      expect(MockReportService).toHaveBeenCalledWith(mockConfig, expect.anything());
    });
  });

  describe('error handling', () => {
    it('should log error and exit with code 1 when loadConfig throws', async () => {
      mockLoadConfig.mockRejectedValueOnce(new Error('Config not found'));
      await runCli(['report']);
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Config not found'),
      );
      expect(exitSpy).toHaveBeenCalledWith(1);
    });

    it('should log error and exit with code 1 when runtime.report throws', async () => {
      mockReport.mockRejectedValueOnce(new Error('Report failed'));
      await runCli(['report']);
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('Report failed'),
      );
      expect(exitSpy).toHaveBeenCalledWith(1);
    });

    it('should handle non-Error throws and stringify them', async () => {
      mockReport.mockRejectedValueOnce('string error');
      await runCli(['report']);
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        expect.stringContaining('string error'),
      );
      expect(exitSpy).toHaveBeenCalledWith(1);
    });
  });
});
