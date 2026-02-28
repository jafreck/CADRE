import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

vi.mock('../../../../packages/agent-runtime/src/backend/factory.js', () => ({
  createAgentBackend: vi.fn(),
}));

import { AgentLauncher } from '../../../../packages/agent-runtime/src/launcher/agent-launcher.js';
import type { BackendRuntimeConfig, BackendLoggerLike, AgentBackend } from '../../../../packages/agent-runtime/src/backend/backend.js';
import type { AgentInvocation, AgentResult } from '../../../../packages/agent-runtime/src/context/types.js';
import { createAgentBackend } from '../../../../packages/agent-runtime/src/backend/factory.js';

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

describe('AgentLauncher', () => {
  let mockBackend: { name: string; init: ReturnType<typeof vi.fn>; invoke: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    vi.clearAllMocks();
    mockBackend = {
      name: 'copilot',
      init: vi.fn().mockResolvedValue(undefined),
      invoke: vi.fn().mockResolvedValue({
        agent: 'code-writer',
        success: true,
        exitCode: 0,
        timedOut: false,
        duration: 1000,
        stdout: '',
        stderr: '',
        tokenUsage: 100,
        outputPath: '/tmp/output.md',
        outputExists: true,
      } satisfies AgentResult),
    };
    mockCreateAgentBackend.mockReturnValue(mockBackend as unknown as AgentBackend);
  });

  it('should create backend via createAgentBackend', () => {
    const config = makeConfig();
    const logger = makeLogger();
    new AgentLauncher(config, logger);

    expect(mockCreateAgentBackend).toHaveBeenCalledWith(config, logger);
  });

  it('should delegate init() to the backend', async () => {
    const launcher = new AgentLauncher(makeConfig(), makeLogger());
    await launcher.init();

    expect(mockBackend.init).toHaveBeenCalledOnce();
  });

  it('should delegate launchAgent() to the backend invoke()', async () => {
    const launcher = new AgentLauncher(makeConfig(), makeLogger());
    const invocation = makeInvocation();

    const result = await launcher.launchAgent(invocation, '/tmp/worktree');

    expect(mockBackend.invoke).toHaveBeenCalledWith(invocation, '/tmp/worktree');
    expect(result.success).toBe(true);
    expect(result.agent).toBe('code-writer');
  });

  it('should propagate backend invoke failure', async () => {
    mockBackend.invoke.mockResolvedValue({
      agent: 'code-writer',
      success: false,
      exitCode: 1,
      timedOut: false,
      duration: 500,
      stdout: '',
      stderr: 'error',
      tokenUsage: 0,
      outputPath: '/tmp/output.md',
      outputExists: false,
      error: 'process failed',
    } satisfies AgentResult);

    const launcher = new AgentLauncher(makeConfig(), makeLogger());
    const result = await launcher.launchAgent(makeInvocation(), '/tmp/worktree');

    expect(result.success).toBe(false);
    expect(result.error).toBe('process failed');
  });
});

describe('AgentLauncher.validateAgentFiles', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = join(tmpdir(), `agent-launcher-test-${Date.now()}`);
    await mkdir(tempDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('should return empty array when all agent files exist and are non-empty', async () => {
    await writeFile(join(tempDir, 'alpha.md'), 'content');
    await writeFile(join(tempDir, 'beta.md'), 'content');

    const issues = await AgentLauncher.validateAgentFiles(tempDir, [
      { name: 'alpha' },
      { name: 'beta' },
    ]);

    expect(issues).toEqual([]);
  });

  it('should report missing agent files', async () => {
    const issues = await AgentLauncher.validateAgentFiles(tempDir, [
      { name: 'missing-agent' },
    ]);

    expect(issues).toHaveLength(1);
    expect(issues[0]).toContain('Missing');
    expect(issues[0]).toContain('missing-agent.md');
  });

  it('should report empty agent files', async () => {
    await writeFile(join(tempDir, 'empty-agent.md'), '');

    const issues = await AgentLauncher.validateAgentFiles(tempDir, [
      { name: 'empty-agent' },
    ]);

    expect(issues).toHaveLength(1);
    expect(issues[0]).toContain('Empty');
  });

  it('should return empty array for no agent definitions', async () => {
    const issues = await AgentLauncher.validateAgentFiles(tempDir, []);
    expect(issues).toEqual([]);
  });
});
