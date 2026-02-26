import { describe, it, expect, vi, beforeEach } from 'vitest';
import { writeFile } from 'node:fs/promises';
import { DependencyResolver } from '../src/core/dependency-resolver.js';
import { IssueDag } from '../src/core/issue-dag.js';
import { DependencyResolutionError } from '../src/errors.js';
import type { IssueDetail } from '../src/platform/provider.js';
import type { AgentLauncher } from '../src/core/agent-launcher.js';
import type { WorktreeManager } from '../src/git/worktree.js';
import type { AgentResult } from '../src/agents/types.js';
import type { RuntimeConfig } from '../src/config/loader.js';
import { Logger } from '../src/logging/logger.js';

function makeIssue(number: number): IssueDetail {
  return {
    number,
    title: `Issue ${number}`,
    body: '',
    labels: [],
    assignees: [],
    comments: [],
    state: 'open',
    createdAt: '',
    updatedAt: '',
    linkedPRs: [],
  };
}

function makeConfig(): RuntimeConfig {
  return {
    projectName: 'test-project',
    repository: 'owner/repo',
    repoPath: '/tmp/repo',
    baseBranch: 'main',
    stateDir: '/tmp/cadre',
    worktreeRoot: '/tmp/worktrees',
    issues: { ids: [] },
    agent: { backend: 'copilot' as const },
    copilot: {
      cliCommand: 'copilot',
      agentDir: '.github/agents',
      timeout: 300000,
    },
  } as unknown as RuntimeConfig;
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

function makeAgentResult(outputPath: string, overrides: Partial<AgentResult> = {}): AgentResult {
  return {
    agent: 'dependency-analyst',
    success: true,
    exitCode: 0,
    timedOut: false,
    duration: 100,
    stdout: '',
    stderr: '',
    tokenUsage: null,
    outputPath,
    outputExists: true,
    ...overrides,
  };
}

function cadreJson(obj: unknown): string {
  return `\`\`\`cadre-json\n${JSON.stringify(obj)}\n\`\`\`\n`;
}

describe('DependencyResolver', () => {
  let config: RuntimeConfig;
  let logger: Logger;
  let mockLaunchAgent: ReturnType<typeof vi.fn>;
  let launcher: AgentLauncher;

  beforeEach(() => {
    config = makeConfig();
    logger = makeLogger();
    mockLaunchAgent = vi.fn();
    launcher = { launchAgent: mockLaunchAgent } as unknown as AgentLauncher;
  });

  it('successful resolution returns a correctly constructed IssueDag', async () => {
    const issues = [makeIssue(1), makeIssue(2), makeIssue(3)];
    // Issue 2 depends on 1, issue 3 depends on 1
    const depMap = { '2': [1], '3': [1] };

    mockLaunchAgent.mockImplementationOnce(async (invocation: { outputPath: string }) => {
      await writeFile(invocation.outputPath, cadreJson(depMap), 'utf-8');
      return makeAgentResult(invocation.outputPath);
    });

    const resolver = new DependencyResolver(config, launcher, logger);
    const dag = await resolver.resolve(issues, '/repo');

    expect(dag).toBeInstanceOf(IssueDag);
    const waves = dag.getWaves();
    // Issue 1 has no deps → wave 0; issues 2 and 3 depend on 1 → wave 1
    expect(waves).toHaveLength(2);
    expect(waves[0].map((i) => i.number)).toEqual([1]);
    expect(waves[1].map((i) => i.number).sort()).toEqual([2, 3]);
    // Agent should have been called only once
    expect(mockLaunchAgent).toHaveBeenCalledTimes(1);
  });

  it('ignores issue numbers in agent output that are not in the provided issue list', async () => {
    const issues = [makeIssue(1), makeIssue(2)];
    // 999 is not in the issue list
    const depMap = { '1': [], '2': [1], '999': [1] };

    mockLaunchAgent.mockImplementationOnce(async (invocation: { outputPath: string }) => {
      await writeFile(invocation.outputPath, cadreJson(depMap), 'utf-8');
      return makeAgentResult(invocation.outputPath);
    });

    const resolver = new DependencyResolver(config, launcher, logger);
    const dag = await resolver.resolve(issues, '/repo');

    expect(dag).toBeInstanceOf(IssueDag);
    const waves = dag.getWaves();
    // Only issues 1 and 2 should appear; 999 is ignored
    const allNums = waves.flat().map((i) => i.number);
    expect(allNums).not.toContain(999);
    expect(allNums.sort()).toEqual([1, 2]);
  });

  it('retries once on malformed JSON agent output', async () => {
    const issues = [makeIssue(1), makeIssue(2)];
    const validDepMap = { '2': [1] };

    // First call: write malformed JSON
    mockLaunchAgent.mockImplementationOnce(async (invocation: { outputPath: string }) => {
      await writeFile(invocation.outputPath, 'not valid json!!!', 'utf-8');
      return makeAgentResult(invocation.outputPath);
    });
    // Second call (retry): write valid cadre-json
    mockLaunchAgent.mockImplementationOnce(async (invocation: { outputPath: string }) => {
      await writeFile(invocation.outputPath, cadreJson(validDepMap), 'utf-8');
      return makeAgentResult(invocation.outputPath);
    });

    const resolver = new DependencyResolver(config, launcher, logger);
    const dag = await resolver.resolve(issues, '/repo');

    expect(dag).toBeInstanceOf(IssueDag);
    expect(mockLaunchAgent).toHaveBeenCalledTimes(2);
  });

  it('retries once when agent output contains a cycle', async () => {
    const issues = [makeIssue(1), makeIssue(2)];
    // First call: cyclic dep map (1 depends on 2, 2 depends on 1)
    const cyclicDepMap = { '1': [2], '2': [1] };
    // Second call: valid acyclic dep map
    const validDepMap = { '2': [1] };

    mockLaunchAgent.mockImplementationOnce(async (invocation: { outputPath: string }) => {
      await writeFile(invocation.outputPath, cadreJson(cyclicDepMap), 'utf-8');
      return makeAgentResult(invocation.outputPath);
    });
    mockLaunchAgent.mockImplementationOnce(async (invocation: { outputPath: string }) => {
      await writeFile(invocation.outputPath, cadreJson(validDepMap), 'utf-8');
      return makeAgentResult(invocation.outputPath);
    });

    const resolver = new DependencyResolver(config, launcher, logger);
    const dag = await resolver.resolve(issues, '/repo');

    expect(dag).toBeInstanceOf(IssueDag);
    expect(mockLaunchAgent).toHaveBeenCalledTimes(2);
    // On cycle retry, the hint should be included in the second invocation's context
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('cycle detected'),
    );
  });

  it('throws DependencyResolutionError when retries are exhausted (malformed JSON both times)', async () => {
    const issues = [makeIssue(1)];

    mockLaunchAgent.mockImplementation(async (invocation: { outputPath: string }) => {
      await writeFile(invocation.outputPath, 'bad json', 'utf-8');
      return makeAgentResult(invocation.outputPath);
    });

    const resolver = new DependencyResolver(config, launcher, logger);
    await expect(resolver.resolve(issues, '/repo')).rejects.toThrow(DependencyResolutionError);
    expect(mockLaunchAgent).toHaveBeenCalledTimes(2);
  });

  it('throws DependencyResolutionError when retries are exhausted (cycle both times)', async () => {
    const issues = [makeIssue(1), makeIssue(2)];
    const cyclicDepMap = { '1': [2], '2': [1] };

    mockLaunchAgent.mockImplementation(async (invocation: { outputPath: string }) => {
      await writeFile(invocation.outputPath, cadreJson(cyclicDepMap), 'utf-8');
      return makeAgentResult(invocation.outputPath);
    });

    const resolver = new DependencyResolver(config, launcher, logger);
    await expect(resolver.resolve(issues, '/repo')).rejects.toThrow(DependencyResolutionError);
    expect(mockLaunchAgent).toHaveBeenCalledTimes(2);
  });

  it('throws DependencyResolutionError when agent fails to produce output', async () => {
    const issues = [makeIssue(1)];

    mockLaunchAgent.mockResolvedValue(
      makeAgentResult('/some/path', { success: false, outputExists: false, error: 'agent crashed' }),
    );

    const resolver = new DependencyResolver(config, launcher, logger);
    await expect(resolver.resolve(issues, '/repo')).rejects.toThrow(DependencyResolutionError);
  });

  it('uses worktreeManager.provisionForDependencyAnalyst() as agent cwd when provided', async () => {
    const issues = [makeIssue(1), makeIssue(2)];
    const depMap = { '2': [1] };
    const dagWorktreePath = '/tmp/worktrees/dag-resolver-test-run-id';

    const mockProvision = vi.fn().mockResolvedValue(dagWorktreePath);
    const mockRemove = vi.fn().mockResolvedValue(undefined);
    const worktreeManager = {
      provisionForDependencyAnalyst: mockProvision,
      removeWorktreeAtPath: mockRemove,
    } as unknown as WorktreeManager;

    mockLaunchAgent.mockImplementationOnce(async (invocation: { outputPath: string }, cwd: string) => {
      await writeFile(invocation.outputPath, cadreJson(depMap), 'utf-8');
      expect(cwd).toBe(dagWorktreePath);
      return makeAgentResult(invocation.outputPath);
    });

    const resolver = new DependencyResolver(config, launcher, logger, worktreeManager);
    const dag = await resolver.resolve(issues, '/repo');

    expect(dag).toBeInstanceOf(IssueDag);
    expect(mockProvision).toHaveBeenCalledTimes(1);
    // runId is a UUID — just verify it was called with a non-empty string
    expect(typeof mockProvision.mock.calls[0][0]).toBe('string');
    expect(mockProvision.mock.calls[0][0].length).toBeGreaterThan(0);
    // Worktree should be cleaned up after resolution
    expect(mockRemove).toHaveBeenCalledTimes(1);
    expect(mockRemove).toHaveBeenCalledWith(dagWorktreePath);
  });
});
