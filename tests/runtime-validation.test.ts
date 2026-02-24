import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { makeRuntimeConfig } from './helpers/make-runtime-config.js';

// Mock heavy dependencies before importing CadreRuntime
vi.mock('../src/logging/logger.js', () => {
  const Logger = vi.fn().mockImplementation(() => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    child: vi.fn().mockReturnValue({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
    agentLogger: vi.fn().mockReturnValue({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
  }));
  return { Logger };
});

vi.mock('../src/platform/factory.js', () => ({
  createPlatformProvider: vi.fn().mockReturnValue({
    name: 'MockProvider',
    connect: vi.fn().mockResolvedValue(undefined),
    disconnect: vi.fn().mockResolvedValue(undefined),
    checkAuth: vi.fn().mockResolvedValue(true),
    getIssue: vi.fn(),
    listIssues: vi.fn(),
  }),
}));

vi.mock('../src/validation/index.js', () => ({
  PreRunValidationSuite: vi.fn(),
  gitValidator: { name: 'git', validate: vi.fn() },
  agentBackendValidator: { name: 'agent-backend', validate: vi.fn() },
  platformValidator: { name: 'platform', validate: vi.fn() },
  commandValidator: { name: 'command', validate: vi.fn() },
  diskValidator: { name: 'disk', validate: vi.fn() },
}));

import { CadreRuntime } from '../src/core/runtime.js';
import { PreRunValidationSuite } from '../src/validation/index.js';

const makeConfig = (skipValidation = false) =>
  makeRuntimeConfig({
    stateDir: '/tmp/cadre-state',
    branchTemplate: 'cadre/issue-{issue}',
    issues: { ids: [1] },
    commits: { conventional: true, sign: false, commitPerPhase: true, squashBeforePR: false },
    pullRequest: { autoCreate: true, draft: true, labels: ['cadre-generated'], reviewers: [], linkIssue: true },
    options: {
      maxParallelIssues: 3,
      maxParallelAgents: 3,
      maxRetriesPerTask: 3,
      dryRun: false,
      resume: false,
      invocationDelayMs: 0,
      buildVerification: true,
      testVerification: true,
      perTaskBuildCheck: true,
      maxBuildFixRounds: 2,
      skipValidation,
      maxIntegrationFixRounds: 1,
      ambiguityThreshold: 5,
      haltOnAmbiguity: false,
      respondToReviews: false,
    },
  });

describe('CadreRuntime.validate()', () => {
  let mockRunSuite: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockRunSuite = vi.fn();
    (PreRunValidationSuite as unknown as ReturnType<typeof vi.fn>).mockImplementation(() => ({
      run: mockRunSuite,
    }));
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('should return true when the suite passes', async () => {
    mockRunSuite.mockResolvedValue(true);
    const runtime = new CadreRuntime(makeConfig());
    const result = await runtime.validate();
    expect(result).toBe(true);
  });

  it('should return false when the suite fails', async () => {
    mockRunSuite.mockResolvedValue(false);
    const runtime = new CadreRuntime(makeConfig());
    const result = await runtime.validate();
    expect(result).toBe(false);
  });

  it('should construct PreRunValidationSuite with all five validators', async () => {
    mockRunSuite.mockResolvedValue(true);
    const runtime = new CadreRuntime(makeConfig());
    await runtime.validate();
    expect(PreRunValidationSuite).toHaveBeenCalledOnce();
    const [validators] = (PreRunValidationSuite as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [unknown[]];
    expect(Array.isArray(validators)).toBe(true);
    expect((validators as unknown[]).length).toBe(5);
  });

  it('should pass config to the suite run method', async () => {
    mockRunSuite.mockResolvedValue(true);
    const config = makeConfig();
    const runtime = new CadreRuntime(config);
    await runtime.validate();
    expect(mockRunSuite).toHaveBeenCalledWith(config);
  });
});

describe('CadreRuntime.run() – validation integration', () => {
  let mockRunSuite: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockRunSuite = vi.fn();
    (PreRunValidationSuite as unknown as ReturnType<typeof vi.fn>).mockImplementation(() => ({
      run: mockRunSuite,
    }));
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('should throw when validation fails and skipValidation is false', async () => {
    mockRunSuite.mockResolvedValue(false);
    const runtime = new CadreRuntime(makeConfig(false));
    await expect(runtime.run()).rejects.toThrow(/validation failed/i);
  });

  it('should not call PreRunValidationSuite.run when skipValidation is true', async () => {
    mockRunSuite.mockResolvedValue(true);
    const runtime = new CadreRuntime(makeConfig(true));
    // run() will fail downstream (auth/issues), but validation should not be called
    try {
      await runtime.run();
    } catch {
      // ignore downstream errors
    }
    expect(mockRunSuite).not.toHaveBeenCalled();
  });

  it('should include --skip-validation hint in the error message when validation fails', async () => {
    mockRunSuite.mockResolvedValue(false);
    const runtime = new CadreRuntime(makeConfig(false));
    await expect(runtime.run()).rejects.toThrow('--skip-validation');
  });
});
