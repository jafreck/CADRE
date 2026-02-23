import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { AgentLauncher } from '../src/core/agent-launcher.js';
import { AGENT_DEFINITIONS } from '../src/agents/types.js';
import { Logger } from '../src/logging/logger.js';
import type { CadreConfig } from '../src/config/schema.js';
import type { AgentInvocation } from '../src/agents/types.js';

vi.mock('../src/agents/backend-factory.js', () => ({
  createAgentBackend: vi.fn(),
}));

import { createAgentBackend } from '../src/agents/backend-factory.js';
const mockCreateAgentBackend = vi.mocked(createAgentBackend);

function makeConfig(): CadreConfig {
  return {
    projectName: 'test-project',
    repository: 'owner/repo',
    repoPath: '/tmp/repo',
    baseBranch: 'main',
    issues: { ids: [42] },
    copilot: {
      cliCommand: 'copilot',
      agentDir: '.github/agents',
      timeout: 300000,
    },
    environment: {
      inheritShellPath: true,
      extraPath: [],
    },
  } as CadreConfig;
}

function makeLogger(): Logger {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    child: vi.fn().mockReturnValue({
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }),
    agentLogger: vi.fn().mockReturnValue({
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    }),
  } as unknown as Logger;
}

function makeInvocation(overrides: Partial<AgentInvocation> = {}): AgentInvocation {
  return {
    agent: 'code-writer',
    issueNumber: 42,
    phase: 3,
    taskId: 'task-001',
    contextPath: '/tmp/worktree/.cadre/issues/42/contexts/ctx.json',
    outputPath: '/tmp/worktree/.cadre/issues/42/outputs/result.md',
    ...overrides,
  };
}

describe('AgentLauncher', () => {
  let mockLogger: Logger;
  let mockConfig: CadreConfig;
  let mockBackend: { name: string; init: ReturnType<typeof vi.fn>; invoke: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    vi.clearAllMocks();
    mockLogger = makeLogger();
    mockConfig = makeConfig();
    mockBackend = {
      name: 'copilot',
      init: vi.fn().mockResolvedValue(undefined),
      invoke: vi.fn().mockResolvedValue({ success: true, agent: 'code-writer', tokenUsage: 0, outputExists: true }),
    };
    mockCreateAgentBackend.mockReturnValue(mockBackend as never);
  });

  it('should be constructable', () => {
    const launcher = new AgentLauncher(mockConfig, mockLogger);
    expect(launcher).toBeDefined();
  });

  it('should have init method', () => {
    const launcher = new AgentLauncher(mockConfig, mockLogger);
    expect(typeof launcher.init).toBe('function');
  });

  it('should have launchAgent method', () => {
    const launcher = new AgentLauncher(mockConfig, mockLogger);
    expect(typeof launcher.launchAgent).toBe('function');
  });

  it('should call createAgentBackend with config and logger on construction', () => {
    new AgentLauncher(mockConfig, mockLogger);
    expect(mockCreateAgentBackend).toHaveBeenCalledOnce();
    expect(mockCreateAgentBackend).toHaveBeenCalledWith(mockConfig, mockLogger);
  });

  it('should delegate init() to backend.init()', async () => {
    const launcher = new AgentLauncher(mockConfig, mockLogger);
    await launcher.init();
    expect(mockBackend.init).toHaveBeenCalledOnce();
  });

  it('should return the result of backend.init()', async () => {
    const launcher = new AgentLauncher(mockConfig, mockLogger);
    await expect(launcher.init()).resolves.toBeUndefined();
  });

  it('should delegate launchAgent() to backend.invoke() with invocation and worktreePath', async () => {
    const launcher = new AgentLauncher(mockConfig, mockLogger);
    const invocation = makeInvocation();
    await launcher.launchAgent(invocation, '/tmp/worktree');
    expect(mockBackend.invoke).toHaveBeenCalledOnce();
    expect(mockBackend.invoke).toHaveBeenCalledWith(invocation, '/tmp/worktree');
  });

  it('should return the result from backend.invoke()', async () => {
    const expectedResult = { success: true, agent: 'code-writer', tokenUsage: 100, outputExists: true };
    mockBackend.invoke.mockResolvedValue(expectedResult);
    const launcher = new AgentLauncher(mockConfig, mockLogger);
    const result = await launcher.launchAgent(makeInvocation(), '/tmp/worktree');
    expect(result).toEqual(expectedResult);
  });

  it('should propagate failure result from backend.invoke()', async () => {
    const failResult = { success: false, agent: 'code-writer', tokenUsage: 0, outputExists: false, error: 'agent failed' };
    mockBackend.invoke.mockResolvedValue(failResult);
    const launcher = new AgentLauncher(mockConfig, mockLogger);
    const result = await launcher.launchAgent(makeInvocation(), '/tmp/worktree');
    expect(result.success).toBe(false);
    expect(result.error).toBe('agent failed');
  });

  it('should propagate errors thrown by backend.init()', async () => {
    mockBackend.init.mockRejectedValue(new Error('backend unavailable'));
    const launcher = new AgentLauncher(mockConfig, mockLogger);
    await expect(launcher.init()).rejects.toThrow('backend unavailable');
  });

  it('should propagate errors thrown by backend.invoke()', async () => {
    mockBackend.invoke.mockRejectedValue(new Error('invoke failed'));
    const launcher = new AgentLauncher(mockConfig, mockLogger);
    await expect(launcher.launchAgent(makeInvocation(), '/tmp/worktree')).rejects.toThrow('invoke failed');
  });
});

describe('AgentLauncher.validateAgentFiles', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = join(tmpdir(), `cadre-test-${Date.now()}`);
    await mkdir(tempDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('should return empty array when all agent files exist and are non-empty', async () => {
    for (const agent of AGENT_DEFINITIONS) {
      await writeFile(join(tempDir, `${agent.name}.agent.md`), `# ${agent.name}\nContent`);
    }
    const issues = await AgentLauncher.validateAgentFiles(tempDir);
    expect(issues).toEqual([]);
  });

  it('should report missing files when agent files do not exist', async () => {
    // Create all files except the first agent
    const [first, ...rest] = AGENT_DEFINITIONS;
    for (const agent of rest) {
      await writeFile(join(tempDir, `${agent.name}.agent.md`), `# ${agent.name}\nContent`);
    }
    const issues = await AgentLauncher.validateAgentFiles(tempDir);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toContain('Missing');
    expect(issues[0]).toContain(`${first.name}.agent.md`);
  });

  it('should report empty files', async () => {
    for (const agent of AGENT_DEFINITIONS) {
      await writeFile(join(tempDir, `${agent.name}.agent.md`), `# ${agent.name}\nContent`);
    }
    // Overwrite the last agent's file with empty content
    const lastAgent = AGENT_DEFINITIONS[AGENT_DEFINITIONS.length - 1];
    await writeFile(join(tempDir, `${lastAgent.name}.agent.md`), '');

    const issues = await AgentLauncher.validateAgentFiles(tempDir);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toContain('Empty');
    expect(issues[0]).toContain(`${lastAgent.name}.agent.md`);
  });

  it('should report multiple issues when several files are missing or empty', async () => {
    // Only create one file; all others will be missing
    const firstAgent = AGENT_DEFINITIONS[0];
    await writeFile(join(tempDir, `${firstAgent.name}.agent.md`), `# ${firstAgent.name}\nContent`);

    const issues = await AgentLauncher.validateAgentFiles(tempDir);
    expect(issues.length).toBe(AGENT_DEFINITIONS.length - 1);
    for (const issue of issues) {
      expect(issue).toContain('Missing');
    }
  });

  it('should return empty array for an empty agent list directory that has all files', async () => {
    // Ensure validateAgentFiles resolves relative paths correctly
    for (const agent of AGENT_DEFINITIONS) {
      await writeFile(join(tempDir, `${agent.name}.agent.md`), 'content');
    }
    const issues = await AgentLauncher.validateAgentFiles(tempDir);
    expect(Array.isArray(issues)).toBe(true);
    expect(issues).toHaveLength(0);
  });
});
