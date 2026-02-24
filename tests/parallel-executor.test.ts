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

  // ── execute() with delayMs ─────────────────────────────────────────────

  it('should call setTimeout for indices > 0 when delayMs is provided', async () => {
    vi.useFakeTimers();

    vi.mocked(mockLauncher.launchAgent).mockImplementation(async (inv) =>
      makeResult(inv.agent, true),
    );

    const executor = new ParallelExecutor(mockLauncher, 3, mockLogger);
    const promise = executor.execute(
      [
        makeInvocation('code-writer', 'task-001'),
        makeInvocation('test-writer', 'task-002'),
        makeInvocation('code-writer', 'task-003'),
      ],
      '/tmp/worktree',
      { delayMs: 500 },
    );

    // Advance timers so the delayed invocations can resolve
    await vi.runAllTimersAsync();
    const results = await promise;

    expect(results).toHaveLength(3);
    results.forEach((r) => expect(r.success).toBe(true));

    vi.useRealTimers();
  });

  it('should not add delay for the first invocation (index 0)', async () => {
    vi.useFakeTimers();
    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');

    vi.mocked(mockLauncher.launchAgent).mockImplementation(async (inv) =>
      makeResult(inv.agent, true),
    );

    const executor = new ParallelExecutor(mockLauncher, 3, mockLogger);
    const promise = executor.execute(
      [
        makeInvocation('code-writer', 'task-001'),
        makeInvocation('test-writer', 'task-002'),
      ],
      '/tmp/worktree',
      { delayMs: 200 },
    );

    await vi.runAllTimersAsync();
    await promise;

    // setTimeout should be called for index=1 only (not for index=0)
    const delayedCalls = setTimeoutSpy.mock.calls.filter((args) => {
      const ms = args[1] as number;
      return ms > 0;
    });
    expect(delayedCalls.length).toBeGreaterThanOrEqual(1);

    setTimeoutSpy.mockRestore();
    vi.useRealTimers();
  });

  // ── executeSettled() ──────────────────────────────────────────────────

  describe('executeSettled()', () => {
    it('should return all results even when some invocations throw', async () => {
      vi.mocked(mockLauncher.launchAgent)
        .mockResolvedValueOnce(makeResult('code-writer', true))
        .mockRejectedValueOnce(new Error('agent crashed'))
        .mockResolvedValueOnce(makeResult('code-writer', true));

      const executor = new ParallelExecutor(mockLauncher, 3, mockLogger);
      const results = await executor.executeSettled(
        [
          makeInvocation('code-writer', 'task-001'),
          makeInvocation('test-writer', 'task-002'),
          makeInvocation('code-writer', 'task-003'),
        ],
        '/tmp/worktree',
      );

      expect(results).toHaveLength(3);
    });

    it('should map fulfilled results to their AgentResult', async () => {
      vi.mocked(mockLauncher.launchAgent).mockResolvedValueOnce(
        makeResult('code-writer', true),
      );

      const executor = new ParallelExecutor(mockLauncher, 2, mockLogger);
      const results = await executor.executeSettled(
        [makeInvocation('code-writer', 'task-001')],
        '/tmp/worktree',
      );

      expect(results[0].success).toBe(true);
      expect(results[0].agent).toBe('code-writer');
    });

    it('should map rejected invocations to a synthetic failure AgentResult with success: false', async () => {
      vi.mocked(mockLauncher.launchAgent).mockRejectedValueOnce(
        new Error('timeout'),
      );

      const executor = new ParallelExecutor(mockLauncher, 2, mockLogger);
      const results = await executor.executeSettled(
        [makeInvocation('test-writer', 'task-fail')],
        '/tmp/worktree',
      );

      expect(results[0].success).toBe(false);
    });

    it('should set the correct agent name on synthetic failure result', async () => {
      vi.mocked(mockLauncher.launchAgent).mockRejectedValueOnce(
        new Error('exploded'),
      );

      const executor = new ParallelExecutor(mockLauncher, 2, mockLogger);
      const results = await executor.executeSettled(
        [makeInvocation('test-writer', 'task-fail')],
        '/tmp/worktree',
      );

      expect(results[0].agent).toBe('test-writer');
    });

    it('should include the rejection reason string in the error field', async () => {
      vi.mocked(mockLauncher.launchAgent).mockRejectedValueOnce(
        new Error('something went very wrong'),
      );

      const executor = new ParallelExecutor(mockLauncher, 2, mockLogger);
      const results = await executor.executeSettled(
        [makeInvocation('code-writer', 'task-fail')],
        '/tmp/worktree',
      );

      expect(results[0].error).toContain('something went very wrong');
    });

    it('should preserve order of results matching input invocations array', async () => {
      vi.mocked(mockLauncher.launchAgent)
        .mockResolvedValueOnce(makeResult('code-writer', true))
        .mockRejectedValueOnce(new Error('second failed'))
        .mockResolvedValueOnce(makeResult('issue-analyst', true));

      const executor = new ParallelExecutor(mockLauncher, 3, mockLogger);
      const results = await executor.executeSettled(
        [
          makeInvocation('code-writer', 'task-001'),
          makeInvocation('test-writer', 'task-002'),
          makeInvocation('issue-analyst', 'task-003'),
        ],
        '/tmp/worktree',
      );

      expect(results[0].agent).toBe('code-writer');
      expect(results[0].success).toBe(true);
      expect(results[1].agent).toBe('test-writer');
      expect(results[1].success).toBe(false);
      expect(results[2].agent).toBe('issue-analyst');
      expect(results[2].success).toBe(true);
    });
  });
});
