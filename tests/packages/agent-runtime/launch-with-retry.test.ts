import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../../packages/agent-runtime/src/backend/factory.js', () => ({
  createAgentBackend: vi.fn(),
}));

import { launchWithRetry, type LaunchWithRetryOptions } from '../../../packages/agent-runtime/src/launch-with-retry.js';
import { AgentLauncher } from '../../../packages/agent-runtime/src/launcher/agent-launcher.js';
import { TokenTracker } from '../../../packages/agent-runtime/src/budget/token-tracker.js';
import type { LoggerLike } from '../../../packages/agent-runtime/src/retry/retry.js';
import type { AgentResult, AgentInvocation } from '../../../packages/agent-runtime/src/context/types.js';
import type { BackendRuntimeConfig, BackendLoggerLike, AgentBackend } from '../../../packages/agent-runtime/src/backend/backend.js';
import { createAgentBackend } from '../../../packages/agent-runtime/src/backend/factory.js';

const mockCreateAgentBackend = vi.mocked(createAgentBackend);

function makeConfig(): BackendRuntimeConfig {
  return {
    agent: {
      backend: 'copilot',
      timeout: 300_000,
      copilot: { cliCommand: 'copilot', agentDir: '.github/agents' },
      claude: { cliCommand: 'claude' },
    },
    copilot: { timeout: 300_000 },
    environment: { extraPath: [] },
  };
}

function makeLogger(): LoggerLike & BackendLoggerLike {
  return { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
}

function makeInvocation(overrides: Partial<AgentInvocation> = {}): AgentInvocation {
  return {
    agent: 'code-writer',
    issueNumber: 42,
    phase: 3,
    contextPath: '/tmp/ctx.json',
    outputPath: '/tmp/output.md',
    ...overrides,
  };
}

function makeSuccessResult(overrides: Partial<AgentResult> = {}): AgentResult {
  return {
    agent: 'code-writer',
    success: true,
    exitCode: 0,
    timedOut: false,
    duration: 1000,
    stdout: '',
    stderr: '',
    tokenUsage: 150,
    outputPath: '/tmp/output.md',
    outputExists: true,
    ...overrides,
  };
}

function makeFailResult(overrides: Partial<AgentResult> = {}): AgentResult {
  return {
    agent: 'code-writer',
    success: false,
    exitCode: 1,
    timedOut: false,
    duration: 500,
    stdout: '',
    stderr: 'error',
    tokenUsage: 50,
    outputPath: '/tmp/output.md',
    outputExists: false,
    error: 'agent failed',
    ...overrides,
  };
}

describe('launchWithRetry', () => {
  let mockBackend: { name: string; init: ReturnType<typeof vi.fn>; invoke: ReturnType<typeof vi.fn> };
  let launcher: AgentLauncher;
  let tokenTracker: TokenTracker;
  let logger: LoggerLike & BackendLoggerLike;

  beforeEach(() => {
    vi.clearAllMocks();
    mockBackend = {
      name: 'copilot',
      init: vi.fn().mockResolvedValue(undefined),
      invoke: vi.fn(),
    };
    mockCreateAgentBackend.mockReturnValue(mockBackend as unknown as AgentBackend);

    const config = makeConfig();
    logger = makeLogger();
    launcher = new AgentLauncher(config, logger);
    tokenTracker = new TokenTracker();
  });

  it('should succeed on first attempt and track tokens', async () => {
    mockBackend.invoke.mockResolvedValue(makeSuccessResult({ tokenUsage: 200 }));

    const result = await launchWithRetry(
      launcher,
      {
        invocation: makeInvocation(),
        worktreePath: '/tmp/worktree',
        maxAttempts: 3,
        baseDelayMs: 1,
      },
      tokenTracker,
      logger,
    );

    expect(result.success).toBe(true);
    expect(result.attempts).toBe(1);
    expect(result.recoveryUsed).toBe(false);
    expect(tokenTracker.getTotal()).toBe(200);
  });

  it('should retry on agent failure and succeed', async () => {
    mockBackend.invoke
      .mockResolvedValueOnce(makeFailResult())
      .mockResolvedValueOnce(makeSuccessResult({ tokenUsage: 100 }));

    const result = await launchWithRetry(
      launcher,
      {
        invocation: makeInvocation(),
        worktreePath: '/tmp/worktree',
        maxAttempts: 3,
        baseDelayMs: 1,
      },
      tokenTracker,
      logger,
    );

    expect(result.success).toBe(true);
    expect(result.attempts).toBe(2);
    expect(tokenTracker.getTotal()).toBe(100);
  });

  it('should fail after exhausting all attempts', async () => {
    mockBackend.invoke.mockResolvedValue(makeFailResult());

    const result = await launchWithRetry(
      launcher,
      {
        invocation: makeInvocation(),
        worktreePath: '/tmp/worktree',
        maxAttempts: 2,
        baseDelayMs: 1,
      },
      tokenTracker,
      logger,
    );

    expect(result.success).toBe(false);
    expect(result.attempts).toBe(2);
    expect(tokenTracker.getTotal()).toBe(0);
  });

  it('should call onRetry callback', async () => {
    const onRetry = vi.fn();
    mockBackend.invoke
      .mockResolvedValueOnce(makeFailResult())
      .mockResolvedValueOnce(makeSuccessResult());

    await launchWithRetry(
      launcher,
      {
        invocation: makeInvocation(),
        worktreePath: '/tmp/worktree',
        maxAttempts: 2,
        baseDelayMs: 1,
        onRetry,
      },
      tokenTracker,
      logger,
    );

    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('should use onExhausted recovery', async () => {
    mockBackend.invoke.mockResolvedValue(makeFailResult());
    const recoveredResult = makeSuccessResult({ tokenUsage: 75 });

    const result = await launchWithRetry(
      launcher,
      {
        invocation: makeInvocation(),
        worktreePath: '/tmp/worktree',
        maxAttempts: 1,
        baseDelayMs: 1,
        onExhausted: async () => recoveredResult,
      },
      tokenTracker,
      logger,
    );

    expect(result.success).toBe(true);
    expect(result.recoveryUsed).toBe(true);
    expect(tokenTracker.getTotal()).toBe(75);
  });

  it('should use custom description for logging', async () => {
    mockBackend.invoke.mockResolvedValue(makeFailResult());

    await launchWithRetry(
      launcher,
      {
        invocation: makeInvocation(),
        worktreePath: '/tmp/worktree',
        maxAttempts: 1,
        baseDelayMs: 1,
        description: 'custom-launch',
      },
      tokenTracker,
      logger,
    );

    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining('custom-launch'),
    );
  });

  it('should default description to agent name', async () => {
    mockBackend.invoke.mockResolvedValue(makeFailResult());

    await launchWithRetry(
      launcher,
      {
        invocation: makeInvocation({ agent: 'test-writer' }),
        worktreePath: '/tmp/worktree',
        maxAttempts: 1,
        baseDelayMs: 1,
      },
      tokenTracker,
      logger,
    );

    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining('agent test-writer'),
    );
  });

  it('should track tokens by correct issue/agent/phase', async () => {
    mockBackend.invoke.mockResolvedValue(makeSuccessResult({ tokenUsage: 300 }));

    await launchWithRetry(
      launcher,
      {
        invocation: makeInvocation({ issueNumber: 99, agent: 'reviewer', phase: 5 }),
        worktreePath: '/tmp/worktree',
        maxAttempts: 1,
        baseDelayMs: 1,
      },
      tokenTracker,
      logger,
    );

    expect(tokenTracker.getIssueTotal(99)).toBe(300);
    expect(tokenTracker.getByAgent()).toEqual({ reviewer: 300 });
    expect(tokenTracker.getByPhase()).toEqual({ 5: 300 });
  });

  it('should handle non-numeric tokenUsage gracefully', async () => {
    mockBackend.invoke.mockResolvedValue(makeSuccessResult({ tokenUsage: null }));

    const result = await launchWithRetry(
      launcher,
      {
        invocation: makeInvocation(),
        worktreePath: '/tmp/worktree',
        maxAttempts: 1,
        baseDelayMs: 1,
      },
      tokenTracker,
      logger,
    );

    expect(result.success).toBe(true);
    expect(tokenTracker.getTotal()).toBe(0);
  });
});
