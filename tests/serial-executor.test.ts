import { describe, it, expect, vi, beforeEach } from 'vitest';
import { SerialExecutor } from '../src/execution/serial-executor.js';
import type { AgentLauncherLike } from '../src/execution/serial-executor.js';
import type { AgentInvocation, AgentResult } from '../src/agents/types.js';
import { Logger } from '../src/logging/logger.js';

function makeInvocation(agent: string): AgentInvocation {
  return {
    agent: agent as AgentInvocation['agent'],
    issueNumber: 42,
    phase: 1,
    contextPath: '/tmp/context.json',
    outputPath: '/tmp/output.md',
  };
}

function makeResult(agent: string, success: boolean): AgentResult {
  return {
    agent: agent as AgentResult['agent'],
    success,
    exitCode: success ? 0 : 1,
    timedOut: false,
    duration: 100,
    stdout: '',
    stderr: '',
    tokenUsage: 500,
    outputPath: '/tmp/output.md',
    outputExists: success,
  };
}

describe('SerialExecutor', () => {
  let mockLauncher: AgentLauncherLike;
  let mockLogger: Logger;

  beforeEach(() => {
    mockLauncher = {
      launchAgent: vi.fn(),
    };
    mockLogger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    } as unknown as Logger;
  });

  it('should execute invocations in order', async () => {
    const callOrder: string[] = [];
    vi.mocked(mockLauncher.launchAgent).mockImplementation(async (inv) => {
      callOrder.push(inv.agent);
      return makeResult(inv.agent, true);
    });

    const executor = new SerialExecutor(mockLauncher, mockLogger);
    const results = await executor.execute(
      [makeInvocation('issue-analyst'), makeInvocation('codebase-scout')],
      '/tmp/worktree',
    );

    expect(callOrder).toEqual(['issue-analyst', 'codebase-scout']);
    expect(results).toHaveLength(2);
    expect(results.every((r) => r.success)).toBe(true);
  });

  it('should stop on failure when option is set', async () => {
    vi.mocked(mockLauncher.launchAgent)
      .mockResolvedValueOnce(makeResult('issue-analyst', false))
      .mockResolvedValueOnce(makeResult('codebase-scout', true));

    const executor = new SerialExecutor(mockLauncher, mockLogger);
    const results = await executor.execute(
      [makeInvocation('issue-analyst'), makeInvocation('codebase-scout')],
      '/tmp/worktree',
      { stopOnFailure: true },
    );

    // Should only have run the first invocation
    expect(results).toHaveLength(1);
    expect(results[0].success).toBe(false);
  });

  it('should continue on failure when option is not set', async () => {
    vi.mocked(mockLauncher.launchAgent)
      .mockResolvedValueOnce(makeResult('issue-analyst', false))
      .mockResolvedValueOnce(makeResult('codebase-scout', true));

    const executor = new SerialExecutor(mockLauncher, mockLogger);
    const results = await executor.execute(
      [makeInvocation('issue-analyst'), makeInvocation('codebase-scout')],
      '/tmp/worktree',
    );

    expect(results).toHaveLength(2);
    expect(results[0].success).toBe(false);
    expect(results[1].success).toBe(true);
  });
});
