import { describe, it, expect, vi, beforeEach } from 'vitest';
import { makeRuntimeConfig } from './helpers/make-runtime-config.js';
import type { AgentInvocation } from '../src/agents/types.js';

vi.mock('../src/util/process.js', () => ({
  spawnProcess: vi.fn(),
  stripVSCodeEnv: vi.fn((env: Record<string, string | undefined>) => ({ ...env })),
  trackProcess: vi.fn(),
}));

vi.mock('../src/util/fs.js', () => ({
  exists: vi.fn(),
  ensureDir: vi.fn(),
}));

vi.mock('node:fs/promises', () => ({
  writeFile: vi.fn(),
}));

import { spawnProcess, trackProcess } from '../src/util/process.js';
import { exists, ensureDir } from '../src/util/fs.js';
import { writeFile } from 'node:fs/promises';
import { AgentBackend, CopilotBackend, ClaudeBackend } from '../src/agents/backend.js';

const mockSpawnProcess = vi.mocked(spawnProcess);
const mockTrackProcess = vi.mocked(trackProcess);
const mockExists = vi.mocked(exists);
const mockEnsureDir = vi.mocked(ensureDir);
const mockWriteFile = vi.mocked(writeFile);

function makeProcessResult(overrides: Partial<{
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}> = {}) {
  return {
    exitCode: overrides.exitCode ?? 0,
    stdout: overrides.stdout ?? '',
    stderr: overrides.stderr ?? '',
    signal: null,
    timedOut: overrides.timedOut ?? false,
  };
}

function setupSpawn(result: ReturnType<typeof makeProcessResult>) {
  const fakeChild = {} as never;
  mockSpawnProcess.mockReturnValue({
    promise: Promise.resolve(result),
    process: fakeChild,
  });
  return fakeChild;
}

function makeConfig(overrides: Partial<{
  cliCommand: string;
  agentDir: string;
  model: string;
  timeout: number;
  extraPath: string[];
  claudeCli: string;
}> = {}) {
  return makeRuntimeConfig({
    copilot: {
      cliCommand: overrides.cliCommand ?? 'copilot',
      model: 'claude-sonnet-4.6',
      agentDir: overrides.agentDir ?? '.github/agents',
      timeout: overrides.timeout ?? 300_000,
    },
    agent: {
      backend: 'copilot' as const,
      model: overrides.model,
      timeout: overrides.timeout ?? 300_000,
      copilot: {
        cliCommand: overrides.cliCommand ?? 'copilot',
        agentDir: overrides.agentDir ?? '.github/agents',
      },
      claude: {
        cliCommand: overrides.claudeCli ?? 'claude',
        agentDir: overrides.agentDir ?? '.github/agents',
      },
    },
    environment: {
      inheritShellPath: true,
      extraPath: overrides.extraPath ?? [],
    },
  });
}

function makeInvocation(overrides: Partial<AgentInvocation> = {}): AgentInvocation {
  return {
    agent: 'code-writer',
    issueNumber: 42,
    phase: 3,
    sessionId: 'session-001',
    contextPath: '/tmp/worktree/.cadre/issues/42/contexts/ctx.json',
    outputPath: '/tmp/worktree/.cadre/issues/42/outputs/result.md',
    ...overrides,
  };
}

describe('AgentBackend interface', () => {
  it('CopilotBackend satisfies AgentBackend interface', () => {
    const config = makeConfig();
    const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } as never;
    const backend: AgentBackend = new CopilotBackend(config, logger);
    expect(typeof backend.name).toBe('string');
    expect(typeof backend.init).toBe('function');
    expect(typeof backend.invoke).toBe('function');
  });

  it('ClaudeBackend satisfies AgentBackend interface', () => {
    const config = makeConfig();
    const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } as never;
    const backend: AgentBackend = new ClaudeBackend(config, logger);
    expect(typeof backend.name).toBe('string');
    expect(typeof backend.init).toBe('function');
    expect(typeof backend.invoke).toBe('function');
  });
});

describe('CopilotBackend', () => {
  let logger: ReturnType<typeof vi.fn>;
  let config: ReturnType<typeof makeConfig>;

  beforeEach(() => {
    vi.clearAllMocks();
    logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } as never;
    config = makeConfig();
    mockExists.mockResolvedValue(true);
    mockEnsureDir.mockResolvedValue(undefined);
    mockWriteFile.mockResolvedValue(undefined);
  });

  it('should have name "copilot"', () => {
    const backend = new CopilotBackend(config, logger as never);
    expect(backend.name).toBe('copilot');
  });

  it('should resolve init() without error', async () => {
    const backend = new CopilotBackend(config, logger as never);
    await expect(backend.init()).resolves.toBeUndefined();
  });

  it('should invoke spawnProcess with the configured CLI command', async () => {
    const customConfig = makeConfig({ cliCommand: 'gh-copilot-custom' });
    const backend = new CopilotBackend(customConfig, logger as never);
    setupSpawn(makeProcessResult());
    await backend.invoke(makeInvocation(), '/tmp/worktree');
    expect(mockSpawnProcess).toHaveBeenCalledWith(
      'gh-copilot-custom',
      expect.any(Array),
      expect.any(Object),
    );
  });

  it('should include --agent, -p, --allow-all-tools, --allow-all-paths, --no-ask-user, -s args', async () => {
    const backend = new CopilotBackend(config, logger as never);
    setupSpawn(makeProcessResult());
    const invocation = makeInvocation({ agent: 'test-writer' });
    await backend.invoke(invocation, '/tmp/worktree');

    const [, args] = mockSpawnProcess.mock.calls[0];
    expect(args).toContain('--agent');
    expect(args).toContain('test-writer');
    expect(args).toContain('-p');
    expect(args).toContain('--allow-all-tools');
    expect(args).toContain('--allow-all-paths');
    expect(args).toContain('--no-ask-user');
    expect(args).toContain('-s');
  });

  it('should include --model when config.agent.model is set', async () => {
    const configWithModel = makeConfig({ model: 'claude-sonnet-4.6' });
    const backend = new CopilotBackend(configWithModel, logger as never);
    setupSpawn(makeProcessResult());
    await backend.invoke(makeInvocation(), '/tmp/worktree');

    const [, args] = mockSpawnProcess.mock.calls[0];
    expect(args).toContain('--model');
    expect(args).toContain('claude-sonnet-4.6');
  });

  it('should not include --model when no model is configured', async () => {
    const configNoModel = makeConfig({ model: undefined });
    const backend = new CopilotBackend(configNoModel, logger as never);
    setupSpawn(makeProcessResult());
    await backend.invoke(makeInvocation(), '/tmp/worktree');

    const [, args] = mockSpawnProcess.mock.calls[0];
    expect(args).not.toContain('--model');
  });

  it('should include the contextPath in the prompt', async () => {
    const backend = new CopilotBackend(config, logger as never);
    setupSpawn(makeProcessResult());
    const invocation = makeInvocation({ contextPath: '/tmp/worktree/.cadre/ctx.json' });
    await backend.invoke(invocation, '/tmp/worktree');

    const [, args] = mockSpawnProcess.mock.calls[0];
    const promptIdx = args.indexOf('-p');
    expect(promptIdx).toBeGreaterThanOrEqual(0);
    expect(args[promptIdx + 1]).toContain('/tmp/worktree/.cadre/ctx.json');
  });

  it('should call trackProcess on the spawned process', async () => {
    const backend = new CopilotBackend(config, logger as never);
    const fakeChild = setupSpawn(makeProcessResult());
    await backend.invoke(makeInvocation(), '/tmp/worktree');
    expect(mockTrackProcess).toHaveBeenCalledWith(fakeChild);
  });

  it('should return success=true on exit code 0', async () => {
    const backend = new CopilotBackend(config, logger as never);
    setupSpawn(makeProcessResult({ exitCode: 0 }));
    const result = await backend.invoke(makeInvocation(), '/tmp/worktree');
    expect(result.success).toBe(true);
  });

  it('should return success=false on non-zero exit code', async () => {
    const backend = new CopilotBackend(config, logger as never);
    setupSpawn(makeProcessResult({ exitCode: 1, stderr: 'something failed' }));
    const result = await backend.invoke(makeInvocation(), '/tmp/worktree');
    expect(result.success).toBe(false);
    expect(result.error).toBeTruthy();
  });

  it('should return success=false when timedOut=true even if exitCode=0', async () => {
    const backend = new CopilotBackend(config, logger as never);
    setupSpawn(makeProcessResult({ exitCode: 0, timedOut: true }));
    const result = await backend.invoke(makeInvocation(), '/tmp/worktree');
    expect(result.success).toBe(false);
    expect(result.timedOut).toBe(true);
  });

  it('should return success=false when stderr contains "No such agent:" even if exitCode=0', async () => {
    const backend = new CopilotBackend(config, logger as never);
    setupSpawn(makeProcessResult({
      exitCode: 0,
      stderr: 'No such agent: conflict-resolver, available: adjudicator, code-writer',
    }));
    const result = await backend.invoke(makeInvocation({ agent: 'conflict-resolver' }), '/tmp/worktree');
    expect(result.success).toBe(false);
    expect(result.error).toContain('No such agent:');
  });

  it('should include the "No such agent" message in result.error', async () => {
    const backend = new CopilotBackend(config, logger as never);
    const noSuchAgentMsg = 'No such agent: my-agent, available: code-writer';
    setupSpawn(makeProcessResult({ exitCode: 0, stderr: noSuchAgentMsg }));
    const result = await backend.invoke(makeInvocation(), '/tmp/worktree');
    expect(result.error).toBe(noSuchAgentMsg);
  });

  it('should return the agent name in the result', async () => {
    const backend = new CopilotBackend(config, logger as never);
    setupSpawn(makeProcessResult());
    const result = await backend.invoke(makeInvocation({ agent: 'code-reviewer' }), '/tmp/worktree');
    expect(result.agent).toBe('code-reviewer');
  });

  it('should return outputExists=true when outputPath exists', async () => {
    const backend = new CopilotBackend(config, logger as never);
    setupSpawn(makeProcessResult());
    mockExists.mockResolvedValue(true);
    const result = await backend.invoke(makeInvocation(), '/tmp/worktree');
    expect(result.outputExists).toBe(true);
  });

  it('should return outputExists=false when outputPath does not exist', async () => {
    const backend = new CopilotBackend(config, logger as never);
    setupSpawn(makeProcessResult());
    mockExists.mockResolvedValue(false);
    const result = await backend.invoke(makeInvocation(), '/tmp/worktree');
    expect(result.outputExists).toBe(false);
  });

  it('should set CADRE_ISSUE_NUMBER env var', async () => {
    const backend = new CopilotBackend(config, logger as never);
    setupSpawn(makeProcessResult());
    await backend.invoke(makeInvocation({ issueNumber: 99 }), '/tmp/worktree');
    const [, , opts] = mockSpawnProcess.mock.calls[0];
    expect(opts.env?.['CADRE_ISSUE_NUMBER']).toBe('99');
  });

  it('should set CADRE_WORKTREE_PATH env var', async () => {
    const backend = new CopilotBackend(config, logger as never);
    setupSpawn(makeProcessResult());
    await backend.invoke(makeInvocation(), '/tmp/worktree');
    const [, , opts] = mockSpawnProcess.mock.calls[0];
    expect(opts.env?.['CADRE_WORKTREE_PATH']).toBe('/tmp/worktree');
  });

  it('should set CADRE_PHASE env var', async () => {
    const backend = new CopilotBackend(config, logger as never);
    setupSpawn(makeProcessResult());
    await backend.invoke(makeInvocation({ phase: 3 }), '/tmp/worktree');
    const [, , opts] = mockSpawnProcess.mock.calls[0];
    expect(opts.env?.['CADRE_PHASE']).toBe('3');
  });

  it('should set CADRE_SESSION_ID env var when taskId is provided', async () => {
    const backend = new CopilotBackend(config, logger as never);
    setupSpawn(makeProcessResult());
    await backend.invoke(makeInvocation({ sessionId: 'session-007' }), '/tmp/worktree');
    const [, , opts] = mockSpawnProcess.mock.calls[0];
    expect(opts.env?.['CADRE_SESSION_ID']).toBe('session-007');
  });

  it('should not set CADRE_SESSION_ID env var when taskId is absent', async () => {
    vi.stubEnv('CADRE_SESSION_ID', undefined as unknown as string);
    const backend = new CopilotBackend(config, logger as never);
    setupSpawn(makeProcessResult());
    await backend.invoke(makeInvocation({ sessionId: undefined }), '/tmp/worktree');
    const [, , opts] = mockSpawnProcess.mock.calls[0];
    expect(opts.env?.['CADRE_SESSION_ID']).toBeUndefined();
    vi.unstubAllEnvs();
  });

  it('should prepend extraPath to PATH', async () => {
    const configWithExtraPath = makeConfig({ extraPath: ['/custom/bin', '/extra/bin'] });
    const backend = new CopilotBackend(configWithExtraPath, logger as never);
    setupSpawn(makeProcessResult());
    await backend.invoke(makeInvocation(), '/tmp/worktree');
    const [, , opts] = mockSpawnProcess.mock.calls[0];
    expect(opts.env?.['PATH']).toContain('/custom/bin');
    expect(opts.env?.['PATH']).toContain('/extra/bin');
    // Extra paths should be prepended (appear before existing PATH)
    const pathVal = opts.env?.['PATH'] ?? '';
    expect(pathVal.indexOf('/custom/bin')).toBeLessThan(pathVal.indexOf('/extra/bin') + 10);
  });

  it('should write a log file for the invocation', async () => {
    const backend = new CopilotBackend(config, logger as never);
    setupSpawn(makeProcessResult({ stdout: 'some output', stderr: 'some error' }));
    await backend.invoke(makeInvocation(), '/tmp/worktree');
    expect(mockWriteFile).toHaveBeenCalledOnce();
    const [logPath, content] = mockWriteFile.mock.calls[0];
    expect(String(logPath)).toContain('/tmp/worktree');
    expect(String(content)).toContain('some output');
  });

  it('should return tokenUsage=0 when stdout has no token info', async () => {
    const backend = new CopilotBackend(config, logger as never);
    setupSpawn(makeProcessResult({ stdout: 'no tokens here' }));
    const result = await backend.invoke(makeInvocation(), '/tmp/worktree');
    expect(result.tokenUsage).toBe(0);
  });

  it('should parse token usage from text pattern in stdout', async () => {
    const backend = new CopilotBackend(config, logger as never);
    setupSpawn(makeProcessResult({ stdout: 'Total tokens: 1,234' }));
    const result = await backend.invoke(makeInvocation(), '/tmp/worktree');
    expect(result.tokenUsage).toBe(1234);
  });

  it('should use config.agent.copilot.cliCommand for the CLI invocation', async () => {
    const customConfig = makeConfig({ cliCommand: 'legacy-copilot' });

    const backend = new CopilotBackend(customConfig, logger as never);
    setupSpawn(makeProcessResult());
    await backend.invoke(makeInvocation(), '/tmp/worktree');
    const [cmd] = mockSpawnProcess.mock.calls[0];
    expect(cmd).toBe('legacy-copilot');
  });

  it('should use invocation.timeout when provided', async () => {
    const backend = new CopilotBackend(config, logger as never);
    setupSpawn(makeProcessResult());
    await backend.invoke(makeInvocation({ timeout: 5_000 }), '/tmp/worktree');
    const [, , opts] = mockSpawnProcess.mock.calls[0];
    expect(opts.timeout).toBe(5_000);
  });
});

describe('ClaudeBackend', () => {
  let logger: ReturnType<typeof vi.fn>;
  let config: ReturnType<typeof makeConfig>;

  beforeEach(() => {
    vi.clearAllMocks();
    logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } as never;
    config = makeConfig();
    mockExists.mockResolvedValue(true);
    mockEnsureDir.mockResolvedValue(undefined);
    mockWriteFile.mockResolvedValue(undefined);
  });

  it('should have name "claude"', () => {
    const backend = new ClaudeBackend(config, logger as never);
    expect(backend.name).toBe('claude');
  });

  it('should resolve init() without error', async () => {
    const backend = new ClaudeBackend(config, logger as never);
    await expect(backend.init()).resolves.toBeUndefined();
  });

  it('should invoke spawnProcess with the configured claude CLI command', async () => {
    const customConfig = makeConfig({ claudeCli: '/usr/local/bin/claude' });
    const backend = new ClaudeBackend(customConfig, logger as never);
    setupSpawn(makeProcessResult());
    await backend.invoke(makeInvocation(), '/tmp/worktree');
    expect(mockSpawnProcess).toHaveBeenCalledWith(
      '/usr/local/bin/claude',
      expect.any(Array),
      expect.any(Object),
    );
  });

  it('should include -p, --allowedTools, and --output-format json args', async () => {
    const backend = new ClaudeBackend(config, logger as never);
    setupSpawn(makeProcessResult());
    await backend.invoke(makeInvocation(), '/tmp/worktree');

    const [, args] = mockSpawnProcess.mock.calls[0];
    expect(args).toContain('-p');
    expect(args).toContain('--allowedTools');
    expect(args).toContain('--output-format');
    expect(args).toContain('json');
  });

  it('should include --model when config.agent.model is set', async () => {
    const configWithModel = makeConfig({ model: 'claude-opus-4.5' });
    const backend = new ClaudeBackend(configWithModel, logger as never);
    setupSpawn(makeProcessResult());
    await backend.invoke(makeInvocation(), '/tmp/worktree');

    const [, args] = mockSpawnProcess.mock.calls[0];
    expect(args).toContain('--model');
    expect(args).toContain('claude-opus-4.5');
  });

  it('should not include --model when no model is configured', async () => {
    const configNoModel = makeConfig({ model: undefined });
    const backend = new ClaudeBackend(configNoModel, logger as never);
    setupSpawn(makeProcessResult());
    await backend.invoke(makeInvocation(), '/tmp/worktree');

    const [, args] = mockSpawnProcess.mock.calls[0];
    expect(args).not.toContain('--model');
  });

  it('should include the contextPath in the prompt', async () => {
    const backend = new ClaudeBackend(config, logger as never);
    setupSpawn(makeProcessResult());
    const invocation = makeInvocation({ contextPath: '/tmp/ctx-file.json' });
    await backend.invoke(invocation, '/tmp/worktree');

    const [, args] = mockSpawnProcess.mock.calls[0];
    const promptIdx = args.indexOf('-p');
    expect(promptIdx).toBeGreaterThanOrEqual(0);
    expect(args[promptIdx + 1]).toContain('/tmp/ctx-file.json');
  });

  it('should return success=true on exit code 0', async () => {
    const backend = new ClaudeBackend(config, logger as never);
    setupSpawn(makeProcessResult({ exitCode: 0 }));
    const result = await backend.invoke(makeInvocation(), '/tmp/worktree');
    expect(result.success).toBe(true);
  });

  it('should return success=false on non-zero exit code', async () => {
    const backend = new ClaudeBackend(config, logger as never);
    setupSpawn(makeProcessResult({ exitCode: 2, stderr: 'claude error' }));
    const result = await backend.invoke(makeInvocation(), '/tmp/worktree');
    expect(result.success).toBe(false);
    expect(result.error).toBeTruthy();
  });

  it('should return success=false when timedOut=true', async () => {
    const backend = new ClaudeBackend(config, logger as never);
    setupSpawn(makeProcessResult({ timedOut: true }));
    const result = await backend.invoke(makeInvocation(), '/tmp/worktree');
    expect(result.success).toBe(false);
    expect(result.timedOut).toBe(true);
  });

  it('should parse token usage from Claude JSON output format', async () => {
    const claudeOutput = JSON.stringify({
      usage: {
        input_tokens: 1000,
        output_tokens: 500,
        cache_read_input_tokens: 200,
        cache_creation_input_tokens: 100,
      },
    });
    const backend = new ClaudeBackend(config, logger as never);
    setupSpawn(makeProcessResult({ stdout: claudeOutput }));
    const result = await backend.invoke(makeInvocation(), '/tmp/worktree');
    expect(result.tokenUsage).toBe(1800); // 1000 + 500 + 200 + 100
  });

  it('should parse token usage from text patterns when stdout is not JSON', async () => {
    const backend = new ClaudeBackend(config, logger as never);
    setupSpawn(makeProcessResult({ stdout: 'tokens used: 2500' }));
    const result = await backend.invoke(makeInvocation(), '/tmp/worktree');
    expect(result.tokenUsage).toBe(2500);
  });

  it('should return tokenUsage=0 when no token info is available', async () => {
    const backend = new ClaudeBackend(config, logger as never);
    setupSpawn(makeProcessResult({ stdout: 'agent output with no token info' }));
    const result = await backend.invoke(makeInvocation(), '/tmp/worktree');
    expect(result.tokenUsage).toBe(0);
  });

  it('should set CADRE_ISSUE_NUMBER env var', async () => {
    const backend = new ClaudeBackend(config, logger as never);
    setupSpawn(makeProcessResult());
    await backend.invoke(makeInvocation({ issueNumber: 77 }), '/tmp/worktree');
    const [, , opts] = mockSpawnProcess.mock.calls[0];
    expect(opts.env?.['CADRE_ISSUE_NUMBER']).toBe('77');
  });

  it('should set CADRE_WORKTREE_PATH env var', async () => {
    const backend = new ClaudeBackend(config, logger as never);
    setupSpawn(makeProcessResult());
    await backend.invoke(makeInvocation(), '/tmp/worktree');
    const [, , opts] = mockSpawnProcess.mock.calls[0];
    expect(opts.env?.['CADRE_WORKTREE_PATH']).toBe('/tmp/worktree');
  });

  it('should set CADRE_PHASE env var', async () => {
    const backend = new ClaudeBackend(config, logger as never);
    setupSpawn(makeProcessResult());
    await backend.invoke(makeInvocation({ phase: 4 }), '/tmp/worktree');
    const [, , opts] = mockSpawnProcess.mock.calls[0];
    expect(opts.env?.['CADRE_PHASE']).toBe('4');
  });

  it('should set CADRE_SESSION_ID env var when taskId is provided', async () => {
    const backend = new ClaudeBackend(config, logger as never);
    setupSpawn(makeProcessResult());
    await backend.invoke(makeInvocation({ sessionId: 'session-abc' }), '/tmp/worktree');
    const [, , opts] = mockSpawnProcess.mock.calls[0];
    expect(opts.env?.['CADRE_SESSION_ID']).toBe('session-abc');
  });

  it('should call trackProcess on the spawned process', async () => {
    const backend = new ClaudeBackend(config, logger as never);
    const fakeChild = setupSpawn(makeProcessResult());
    await backend.invoke(makeInvocation(), '/tmp/worktree');
    expect(mockTrackProcess).toHaveBeenCalledWith(fakeChild);
  });

  it('should write a log file for the invocation', async () => {
    const backend = new ClaudeBackend(config, logger as never);
    setupSpawn(makeProcessResult({ stdout: 'claude output', stderr: '' }));
    await backend.invoke(makeInvocation(), '/tmp/worktree');
    expect(mockWriteFile).toHaveBeenCalledOnce();
    const [, content] = mockWriteFile.mock.calls[0];
    expect(String(content)).toContain('claude output');
  });

  it('should use invocation.timeout when provided', async () => {
    const backend = new ClaudeBackend(config, logger as never);
    setupSpawn(makeProcessResult());
    await backend.invoke(makeInvocation({ timeout: 10_000 }), '/tmp/worktree');
    const [, , opts] = mockSpawnProcess.mock.calls[0];
    expect(opts.timeout).toBe(10_000);
  });

  it('should default to "claude" CLI when config.agent.claude.cliCommand is absent', async () => {
    const legacyConfig = makeRuntimeConfig({
      agent: {
        backend: 'copilot',
        copilot: { cliCommand: 'copilot', agentDir: '.github/agents' },
        claude: { cliCommand: '', agentDir: '.github/agents' },
      },
    });

    const backend = new ClaudeBackend(legacyConfig, logger as never);
    setupSpawn(makeProcessResult());
    await backend.invoke(makeInvocation(), '/tmp/worktree');
    const [cmd] = mockSpawnProcess.mock.calls[0];
    expect(cmd).toBe('claude');
  });
});

describe('parseTokenUsage (via invoke)', () => {
  let logger: ReturnType<typeof vi.fn>;
  let config: ReturnType<typeof makeConfig>;

  beforeEach(() => {
    vi.clearAllMocks();
    logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } as never;
    config = makeConfig();
    mockExists.mockResolvedValue(true);
    mockEnsureDir.mockResolvedValue(undefined);
    mockWriteFile.mockResolvedValue(undefined);
  });

  it('should parse total_tokens pattern from stdout', async () => {
    const backend = new ClaudeBackend(config, logger as never);
    setupSpawn(makeProcessResult({ stdout: 'total_tokens: 3000' }));
    const result = await backend.invoke(makeInvocation(), '/tmp/worktree');
    expect(result.tokenUsage).toBe(3000);
  });

  it('should parse "usage: N tokens" pattern from stderr', async () => {
    const backend = new ClaudeBackend(config, logger as never);
    setupSpawn(makeProcessResult({ stderr: 'usage: 750 tokens' }));
    const result = await backend.invoke(makeInvocation(), '/tmp/worktree');
    expect(result.tokenUsage).toBe(750);
  });

  it('should parse comma-separated numbers in token count', async () => {
    const backend = new ClaudeBackend(config, logger as never);
    setupSpawn(makeProcessResult({ stdout: 'Total tokens: 12,345' }));
    const result = await backend.invoke(makeInvocation(), '/tmp/worktree');
    expect(result.tokenUsage).toBe(12345);
  });

  it('should handle JSON with partial usage fields gracefully', async () => {
    const partialJson = JSON.stringify({
      usage: { input_tokens: 500 },
    });
    const backend = new ClaudeBackend(config, logger as never);
    setupSpawn(makeProcessResult({ stdout: partialJson }));
    const result = await backend.invoke(makeInvocation(), '/tmp/worktree');
    expect(result.tokenUsage).toBe(500); // only input_tokens, others default to 0
  });

  it('should return 0 for invalid JSON that is not a plain text token pattern', async () => {
    const backend = new ClaudeBackend(config, logger as never);
    setupSpawn(makeProcessResult({ stdout: '{not: valid json}' }));
    const result = await backend.invoke(makeInvocation(), '/tmp/worktree');
    expect(result.tokenUsage).toBe(0);
  });
});
