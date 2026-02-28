import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@cadre/command-diagnostics', () => ({
  spawnProcess: vi.fn(),
  stripVSCodeEnv: vi.fn((env: Record<string, string | undefined>) => ({ ...env })),
  trackProcess: vi.fn(),
}));

vi.mock('node:fs/promises', () => ({
  writeFile: vi.fn(),
  mkdir: vi.fn(),
  access: vi.fn().mockRejectedValue(new Error('not found')),
}));

import {
  CopilotBackend,
  ClaudeBackend,
  isCopilotCliInvocationError,
  type BackendRuntimeConfig,
  type BackendLoggerLike,
  type AgentBackend,
} from '../../../../packages/agent-runtime/src/backend/backend.js';
import type { AgentInvocation } from '../../../../packages/agent-runtime/src/context/types.js';
import { spawnProcess } from '@cadre/command-diagnostics';

const mockSpawnProcess = vi.mocked(spawnProcess);

function makeConfig(overrides: Partial<BackendRuntimeConfig> = {}): BackendRuntimeConfig {
  return {
    agent: {
      backend: 'copilot',
      timeout: 300_000,
      copilot: { cliCommand: 'copilot', agentDir: '.github/agents' },
      claude: { cliCommand: 'claude' },
    },
    copilot: { timeout: 300_000 },
    environment: { extraPath: [] },
    ...overrides,
  };
}

function makeLogger(): BackendLoggerLike {
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

function mockProcessResult(overrides: Record<string, unknown> = {}) {
  const result = {
    stdout: '',
    stderr: '',
    exitCode: 0,
    timedOut: false,
    ...overrides,
  };
  const child = { pid: 123 };
  mockSpawnProcess.mockReturnValue({
    promise: Promise.resolve(result),
    process: child,
  } as never);
  return result;
}

describe('isCopilotCliInvocationError', () => {
  it('should detect "no such agent:" error', () => {
    expect(isCopilotCliInvocationError('No such agent: foo')).toBe(true);
  });

  it('should detect "error: option" error', () => {
    expect(isCopilotCliInvocationError('error: option --bad is invalid')).toBe(true);
  });

  it('should detect "is invalid. allowed choices are" error', () => {
    expect(isCopilotCliInvocationError('value is invalid. Allowed choices are x, y')).toBe(true);
  });

  it('should detect "unknown option" error', () => {
    expect(isCopilotCliInvocationError('unknown option --foo')).toBe(true);
  });

  it('should return false for normal stderr output', () => {
    expect(isCopilotCliInvocationError('Processing...')).toBe(false);
  });

  it('should return false for empty string', () => {
    expect(isCopilotCliInvocationError('')).toBe(false);
  });
});

describe('CopilotBackend', () => {
  let backend: CopilotBackend;
  let logger: BackendLoggerLike;

  beforeEach(() => {
    vi.clearAllMocks();
    logger = makeLogger();
    backend = new CopilotBackend(makeConfig(), logger);
  });

  it('should have name "copilot"', () => {
    expect(backend.name).toBe('copilot');
  });

  it('should initialize without error', async () => {
    await expect(backend.init()).resolves.toBeUndefined();
    expect(logger.debug).toHaveBeenCalledWith(expect.stringContaining('CopilotBackend initialized'));
  });

  it('should invoke agent and return success result', async () => {
    mockProcessResult({ stdout: 'done', exitCode: 0 });

    const result = await backend.invoke(makeInvocation(), '/tmp/worktree');

    expect(result.success).toBe(true);
    expect(result.agent).toBe('code-writer');
    expect(result.exitCode).toBe(0);
    expect(result.timedOut).toBe(false);
    expect(logger.info).toHaveBeenCalledWith(
      expect.stringContaining('Launching agent (copilot)'),
      expect.any(Object),
    );
  });

  it('should return failure when exit code is non-zero', async () => {
    mockProcessResult({ exitCode: 1, stderr: 'some error' });

    const result = await backend.invoke(makeInvocation(), '/tmp/worktree');

    expect(result.success).toBe(false);
    expect(result.exitCode).toBe(1);
    expect(result.error).toContain('some error');
  });

  it('should return failure when timed out', async () => {
    mockProcessResult({ exitCode: null, timedOut: true, stderr: '' });

    const result = await backend.invoke(makeInvocation(), '/tmp/worktree');

    expect(result.success).toBe(false);
    expect(result.timedOut).toBe(true);
  });

  it('should detect copilot CLI invocation errors in stderr', async () => {
    mockProcessResult({ exitCode: 0, stderr: 'No such agent: code-writer' });

    const result = await backend.invoke(makeInvocation(), '/tmp/worktree');

    expect(result.success).toBe(false);
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining('not found in Copilot agent directory'),
      expect.any(Object),
    );
  });

  it('should use invocation timeout when provided', async () => {
    mockProcessResult();
    const invocation = makeInvocation({ timeout: 60_000 });

    await backend.invoke(invocation, '/tmp/worktree');

    expect(mockSpawnProcess).toHaveBeenCalledWith(
      'copilot',
      expect.any(Array),
      expect.objectContaining({ timeout: 60_000 }),
    );
  });

  it('should include model flag when configured', async () => {
    mockProcessResult();
    const config = makeConfig();
    config.agent.model = 'gpt-4o';
    backend = new CopilotBackend(config, logger);

    await backend.invoke(makeInvocation(), '/tmp/worktree');

    const args = mockSpawnProcess.mock.calls[0][1] as string[];
    expect(args).toContain('--model');
    expect(args).toContain('gpt-4o');
  });

  it('should include sessionId in args when provided', async () => {
    mockProcessResult();

    const result = await backend.invoke(
      makeInvocation({ sessionId: 'session-001' }),
      '/tmp/worktree',
    );

    expect(result.agent).toBe('code-writer');
  });
});

describe('ClaudeBackend', () => {
  let backend: ClaudeBackend;
  let logger: BackendLoggerLike;

  beforeEach(() => {
    vi.clearAllMocks();
    logger = makeLogger();
    backend = new ClaudeBackend(makeConfig(), logger);
  });

  it('should have name "claude"', () => {
    expect(backend.name).toBe('claude');
  });

  it('should initialize without error', async () => {
    await expect(backend.init()).resolves.toBeUndefined();
    expect(logger.debug).toHaveBeenCalledWith(expect.stringContaining('ClaudeBackend initialized'));
  });

  it('should invoke agent and return success result', async () => {
    mockProcessResult({ stdout: '{"result": "ok"}', exitCode: 0 });

    const result = await backend.invoke(makeInvocation(), '/tmp/worktree');

    expect(result.success).toBe(true);
    expect(result.agent).toBe('code-writer');
  });

  it('should return failure when exit code is non-zero', async () => {
    mockProcessResult({ exitCode: 1, stderr: 'claude error' });

    const result = await backend.invoke(makeInvocation(), '/tmp/worktree');

    expect(result.success).toBe(false);
    expect(result.error).toContain('claude error');
  });

  it('should parse JSON token usage from stdout', async () => {
    const jsonOutput = JSON.stringify({
      result: 'ok',
      usage: { input_tokens: 100, output_tokens: 50 },
    });
    mockProcessResult({ stdout: jsonOutput, exitCode: 0 });

    const result = await backend.invoke(makeInvocation(), '/tmp/worktree');

    expect(result.success).toBe(true);
    expect(result.tokenUsage).toBe(150);
  });

  it('should include model flag when configured', async () => {
    mockProcessResult();
    const config = makeConfig();
    config.agent.model = 'claude-sonnet-4-20250514';
    backend = new ClaudeBackend(config, logger);

    await backend.invoke(makeInvocation(), '/tmp/worktree');

    const args = mockSpawnProcess.mock.calls[0][1] as string[];
    expect(args).toContain('--model');
    expect(args).toContain('claude-sonnet-4-20250514');
  });

  it('should use --output-format json flag', async () => {
    mockProcessResult();

    await backend.invoke(makeInvocation(), '/tmp/worktree');

    const args = mockSpawnProcess.mock.calls[0][1] as string[];
    expect(args).toContain('--output-format');
    expect(args).toContain('json');
  });
});
