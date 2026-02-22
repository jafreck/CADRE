import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ─── Hoisted mocks ────────────────────────────────────────────────────────────
const mockSuiteRun = vi.hoisted(() => vi.fn());
const mockSuiteFormat = vi.hoisted(() => vi.fn());
const MockPreRunValidationSuite = vi.hoisted(() =>
  vi.fn().mockImplementation(() => ({
    run: mockSuiteRun,
    formatResults: mockSuiteFormat,
  })),
);

const mockProviderConnect = vi.hoisted(() => vi.fn());
const mockProviderCheckAuth = vi.hoisted(() => vi.fn());
const mockProviderDisconnect = vi.hoisted(() => vi.fn());
const mockProviderListIssues = vi.hoisted(() => vi.fn());
const mockCreatePlatformProvider = vi.hoisted(() =>
  vi.fn().mockReturnValue({
    name: 'MockProvider',
    connect: mockProviderConnect,
    checkAuth: mockProviderCheckAuth,
    disconnect: mockProviderDisconnect,
    listIssues: mockProviderListIssues,
    getIssue: vi.fn().mockResolvedValue({ number: 1, title: 'Test issue', body: '', labels: [], assignees: [] }),
  }),
);

vi.mock('../src/validation/suite.js', () => ({
  PreRunValidationSuite: MockPreRunValidationSuite,
}));

vi.mock('../src/platform/factory.js', () => ({
  createPlatformProvider: mockCreatePlatformProvider,
}));

vi.mock('../src/logging/logger.js', () => ({
  Logger: vi.fn().mockImplementation(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    child: vi.fn().mockReturnThis(),
  })),
}));

vi.mock('../src/git/worktree.js', () => ({
  WorktreeManager: vi.fn().mockImplementation(() => ({})),
}));

vi.mock('../src/core/agent-launcher.js', () => ({
  AgentLauncher: vi.fn().mockImplementation(() => ({
    init: vi.fn().mockResolvedValue(undefined),
  })),
}));

vi.mock('../src/core/fleet-orchestrator.js', () => ({
  FleetOrchestrator: vi.fn().mockImplementation(() => ({
    run: vi.fn().mockResolvedValue({
      success: true,
      issues: [],
      prsCreated: [],
      failedIssues: [],
      totalDuration: 0,
      tokenUsage: { total: 0, byIssue: {}, byAgent: {} },
    }),
  })),
}));

vi.mock('../src/core/checkpoint.js', () => ({
  FleetCheckpointManager: vi.fn().mockImplementation(() => ({})),
}));

vi.mock('../src/core/progress.js', () => ({
  FleetProgressWriter: vi.fn().mockImplementation(() => ({
    appendEvent: vi.fn(),
  })),
}));

vi.mock('../src/util/process.js', () => ({
  killAllTrackedProcesses: vi.fn(),
}));

vi.mock('../src/budget/token-tracker.js', () => ({
  TokenTracker: vi.fn().mockImplementation(() => ({})),
}));

vi.mock('../src/budget/cost-estimator.js', () => ({
  CostEstimator: vi.fn().mockImplementation(() => ({
    estimate: vi.fn().mockReturnValue(0),
    format: vi.fn().mockReturnValue('$0.00'),
  })),
}));

// ─── Imports (after mocks) ────────────────────────────────────────────────────
import { CadreRuntime } from '../src/core/runtime.js';
import { CadreConfigSchema } from '../src/config/schema.js';

// ─── Fixtures ─────────────────────────────────────────────────────────────────
const baseConfig = CadreConfigSchema.parse({
  projectName: 'test-project',
  repository: 'owner/repo',
  repoPath: '/tmp/repo',
  issues: { ids: [1] },
});

const passingSuiteResult = { passed: true, warningCount: 0, results: new Map() };
const failingSuiteResult = { passed: false, warningCount: 0, results: new Map() };

// ─── Tests ────────────────────────────────────────────────────────────────────
describe('CadreRuntime.run() — validation integration', () => {
  let processExitSpy: ReturnType<typeof vi.spyOn>;
  let consoleLogSpy: ReturnType<typeof vi.spyOn>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    processExitSpy = vi.spyOn(process, 'exit').mockImplementation((() => {}) as never);
    consoleLogSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    MockPreRunValidationSuite.mockClear();
    mockSuiteRun.mockReset();
    mockSuiteFormat.mockReset();
    mockProviderConnect.mockResolvedValue(undefined);
    mockProviderCheckAuth.mockResolvedValue(true);
    mockProviderDisconnect.mockResolvedValue(undefined);
    mockProviderListIssues.mockResolvedValue([]);
    mockSuiteFormat.mockReturnValue('✅ all-validators\nPASS');
  });

  afterEach(() => {
    processExitSpy.mockRestore();
    consoleLogSpy.mockRestore();
    consoleErrorSpy.mockRestore();
    // Remove SIGINT/SIGTERM handlers registered by CadreRuntime.setupShutdownHandlers()
    process.removeAllListeners('SIGINT');
    process.removeAllListeners('SIGTERM');
  });

  describe('when skipValidation is not set (default)', () => {
    it('should instantiate PreRunValidationSuite and call run()', async () => {
      mockSuiteRun.mockResolvedValue(passingSuiteResult);

      const runtime = new CadreRuntime(baseConfig);
      await runtime.run();

      expect(MockPreRunValidationSuite).toHaveBeenCalledOnce();
      expect(mockSuiteRun).toHaveBeenCalledWith(baseConfig);
    });

    it('should print formatted validation results to stdout', async () => {
      mockSuiteRun.mockResolvedValue(passingSuiteResult);
      mockSuiteFormat.mockReturnValue('✅ platform\nPASS');

      const runtime = new CadreRuntime(baseConfig);
      await runtime.run();

      expect(mockSuiteFormat).toHaveBeenCalledWith(passingSuiteResult);
      expect(consoleLogSpy).toHaveBeenCalledWith('✅ platform\nPASS');
    });

    it('should call process.exit(1) when validation fails', async () => {
      mockSuiteRun.mockResolvedValue(failingSuiteResult);
      mockSuiteFormat.mockReturnValue('❌ git-validator\nFAIL');

      const runtime = new CadreRuntime(baseConfig);
      await runtime.run();

      expect(processExitSpy).toHaveBeenCalledWith(1);
    });

    it('should print ❌ Pre-run validation failed to stderr when validation fails', async () => {
      mockSuiteRun.mockResolvedValue(failingSuiteResult);
      mockSuiteFormat.mockReturnValue('❌ git-validator\nFAIL');

      const runtime = new CadreRuntime(baseConfig);
      await runtime.run();

      expect(consoleErrorSpy).toHaveBeenCalledWith('❌ Pre-run validation failed');
    });

    it('should not call process.exit(1) when validation passes', async () => {
      mockSuiteRun.mockResolvedValue(passingSuiteResult);

      const runtime = new CadreRuntime(baseConfig);
      await runtime.run();

      expect(processExitSpy).not.toHaveBeenCalledWith(1);
    });

    it('should pass with warnings when validation result has passed: true', async () => {
      const warningResult = { passed: true, warningCount: 2, results: new Map() };
      mockSuiteRun.mockResolvedValue(warningResult);
      mockSuiteFormat.mockReturnValue('⚠️ disk\nPASS (2 warnings)');

      const runtime = new CadreRuntime(baseConfig);
      await runtime.run();

      expect(processExitSpy).not.toHaveBeenCalledWith(1);
    });
  });

  describe('when skipValidation is explicitly false', () => {
    it('should run validation', async () => {
      mockSuiteRun.mockResolvedValue(passingSuiteResult);

      const runtime = new CadreRuntime(baseConfig);
      await runtime.run(false);

      expect(MockPreRunValidationSuite).toHaveBeenCalledOnce();
      expect(mockSuiteRun).toHaveBeenCalledWith(baseConfig);
    });
  });

  describe('when skipValidation is true', () => {
    it('should skip PreRunValidationSuite instantiation', async () => {
      const runtime = new CadreRuntime(baseConfig);
      await runtime.run(true);

      expect(MockPreRunValidationSuite).not.toHaveBeenCalled();
    });

    it('should not call suite.run()', async () => {
      const runtime = new CadreRuntime(baseConfig);
      await runtime.run(true);

      expect(mockSuiteRun).not.toHaveBeenCalled();
    });

    it('should proceed without printing validation output', async () => {
      const runtime = new CadreRuntime(baseConfig);
      await runtime.run(true);

      expect(mockSuiteFormat).not.toHaveBeenCalled();
    });
  });

  describe('run() method signature', () => {
    it('should accept an optional skipValidation boolean parameter', async () => {
      mockSuiteRun.mockResolvedValue(passingSuiteResult);

      const runtime = new CadreRuntime(baseConfig);
      // Both call forms should be valid
      await expect(runtime.run()).resolves.not.toThrow();
    });

    it('should return a FleetResult', async () => {
      mockSuiteRun.mockResolvedValue(passingSuiteResult);

      const runtime = new CadreRuntime(baseConfig);
      const result = await runtime.run();

      expect(result).toHaveProperty('success');
      expect(result).toHaveProperty('issues');
      expect(result).toHaveProperty('prsCreated');
      expect(result).toHaveProperty('failedIssues');
    });
  });
});
