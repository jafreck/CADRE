import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ParallelExecutor } from '../src/execution/parallel-executor.js';
import type { AgentLauncherLike } from '../src/execution/serial-executor.js';
import type { AgentInvocation, AgentResult } from '../src/agents/types.js';
import { Logger } from '../src/logging/logger.js';

function makeInvocation(agent: string, taskId?: string): AgentInvocation {
  return {
    agent: agent as AgentInvocation['agent'],
    issueNumber: 42,
    phase: 3,
    taskId,
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

describe('ParallelExecutor', () => {
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

  it('should execute all invocations and return results', async () => {
    vi.mocked(mockLauncher.launchAgent)
      .mockResolvedValueOnce(makeResult('code-writer', true))
      .mockResolvedValueOnce(makeResult('test-writer', true));

    const executor = new ParallelExecutor(mockLauncher, 2, mockLogger);
    const results = await executor.execute(
      [
        makeInvocation('code-writer', 'task-001'),
        makeInvocation('test-writer', 'task-001'),
      ],
      '/tmp/worktree',
    );

    expect(results).toHaveLength(2);
    expect(results[0].success).toBe(true);
    expect(results[1].success).toBe(true);
    expect(mockLauncher.launchAgent).toHaveBeenCalledTimes(2);
  });

  it('should respect concurrency limits', async () => {
    let currentConcurrency = 0;
    let maxConcurrency = 0;

    vi.mocked(mockLauncher.launchAgent).mockImplementation(async (inv) => {
      currentConcurrency++;
      maxConcurrency = Math.max(maxConcurrency, currentConcurrency);
      await new Promise((resolve) => setTimeout(resolve, 50));
      currentConcurrency--;
      return makeResult(inv.agent, true);
    });

    const executor = new ParallelExecutor(mockLauncher, 1, mockLogger);
    await executor.execute(
      [
        makeInvocation('code-writer', 'task-001'),
        makeInvocation('code-writer', 'task-002'),
        makeInvocation('code-writer', 'task-003'),
      ],
      '/tmp/worktree',
    );

    expect(maxConcurrency).toBe(1);
  });

  it('should handle mixed success/failure results', async () => {
    vi.mocked(mockLauncher.launchAgent)
      .mockResolvedValueOnce(makeResult('code-writer', true))
      .mockResolvedValueOnce(makeResult('code-writer', false));

    const executor = new ParallelExecutor(mockLauncher, 2, mockLogger);
    const results = await executor.execute(
      [
        makeInvocation('code-writer', 'task-001'),
        makeInvocation('code-writer', 'task-002'),
      ],
      '/tmp/worktree',
    );

    expect(results[0].success).toBe(true);
    expect(results[1].success).toBe(false);
  });
});
