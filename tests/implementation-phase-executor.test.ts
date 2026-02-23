import { describe, it, expect, vi, beforeEach } from 'vitest';
import { join } from 'node:path';
import { ImplementationPhaseExecutor } from '../src/executors/implementation-phase-executor.js';
import { BudgetExceededError } from '../src/core/issue-orchestrator.js';
import type { PhaseContext } from '../src/core/phase-executor.js';
import type { AgentResult, ImplementationTask } from '../src/agents/types.js';

vi.mock('../src/util/fs.js', () => ({
  exists: vi.fn().mockResolvedValue(false),
}));

vi.mock('node:fs/promises', () => ({
  writeFile: vi.fn().mockResolvedValue(undefined),
}));

import { exists } from '../src/util/fs.js';
import { writeFile } from 'node:fs/promises';

function makeTask(id: string, deps: string[] = [], files: string[] = []): ImplementationTask {
  return {
    id,
    name: `Task ${id}`,
    description: `Description for ${id}`,
    files: files.length ? files : [`src/${id}.ts`],
    dependencies: deps,
    complexity: 'simple' as const,
    acceptanceCriteria: ['criterion 1'],
  };
}

function makeSuccessAgentResult(agent: string): AgentResult {
  return {
    agent: agent as AgentResult['agent'],
    success: true,
    exitCode: 0,
    timedOut: false,
    duration: 100,
    stdout: '',
    stderr: '',
    tokenUsage: 50,
    outputPath: '/progress/output.md',
    outputExists: true,
  };
}

function makeCtx(overrides: Partial<PhaseContext> = {}): PhaseContext {
  const recordTokens = vi.fn();
  const checkBudget = vi.fn();

  const launcher = {
    launchAgent: vi.fn()
      .mockResolvedValueOnce(makeSuccessAgentResult('code-writer'))
      .mockResolvedValueOnce(makeSuccessAgentResult('test-writer'))
      .mockResolvedValueOnce(makeSuccessAgentResult('code-reviewer')),
  };

  const retryExecutor = {
    execute: vi.fn(async ({ fn }: { fn: (attempt: number) => Promise<unknown> }) => {
      try {
        const result = await fn(1);
        return { success: true, result };
      } catch (err) {
        return { success: false, error: (err as Error).message };
      }
    }),
  };

  const contextBuilder = {
    buildForCodeWriter: vi.fn().mockResolvedValue('/progress/writer-ctx.json'),
    buildForTestWriter: vi.fn().mockResolvedValue('/progress/test-writer-ctx.json'),
    buildForCodeReviewer: vi.fn().mockResolvedValue('/progress/reviewer-ctx.json'),
    buildForFixSurgeon: vi.fn().mockResolvedValue('/progress/fix-ctx.json'),
  };

  const resultParser = {
    parseImplementationPlan: vi.fn().mockResolvedValue([makeTask('task-001')]),
    parseReview: vi.fn().mockResolvedValue({ verdict: 'approved' }),
  };

  const checkpoint = {
    getState: vi.fn().mockReturnValue({ completedTasks: [], blockedTasks: [], currentPhase: 3 }),
    isTaskCompleted: vi.fn().mockReturnValue(false),
    startTask: vi.fn().mockResolvedValue(undefined),
    completeTask: vi.fn().mockResolvedValue(undefined),
    blockTask: vi.fn().mockResolvedValue(undefined),
  };

  const commitManager = {
    getChangedFiles: vi.fn().mockResolvedValue([]),
    getTaskDiff: vi.fn().mockResolvedValue('task diff content'),
    commit: vi.fn().mockResolvedValue(undefined),
  };

  const progressWriter = {
    appendEvent: vi.fn().mockResolvedValue(undefined),
    write: vi.fn().mockResolvedValue(undefined),
  };

  const tokenTracker = {
    getTotal: vi.fn().mockReturnValue(0),
  };

  const logger = {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  };

  return {
    issue: {
      number: 42,
      title: 'Test issue',
      body: 'Test body',
      labels: [],
      assignees: [],
      state: 'open',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      url: 'https://github.com/owner/repo/issues/42',
    },
    worktree: { path: '/tmp/worktree', branch: 'cadre/issue-42', baseCommit: 'abc123', issueNumber: 42 } as never,
    config: {
      options: { maxParallelAgents: 2, maxRetriesPerTask: 3 },
    } as never,
    progressDir: '/tmp/progress',
    contextBuilder: contextBuilder as never,
    launcher: launcher as never,
    resultParser: resultParser as never,
    checkpoint: checkpoint as never,
    commitManager: commitManager as never,
    retryExecutor: retryExecutor as never,
    tokenTracker: tokenTracker as never,
    progressWriter: progressWriter as never,
    platform: {} as never,
    recordTokens,
    checkBudget,
    logger: logger as never,
    ...overrides,
  };
}

describe('ImplementationPhaseExecutor', () => {
  let executor: ImplementationPhaseExecutor;

  beforeEach(() => {
    vi.clearAllMocks();
    executor = new ImplementationPhaseExecutor();
  });

  describe('PhaseExecutor contract', () => {
    it('should have phaseId of 3', () => {
      expect(executor.phaseId).toBe(3);
    });

    it('should have name "Implementation"', () => {
      expect(executor.name).toBe('Implementation');
    });

    it('should implement the PhaseExecutor interface', () => {
      expect(typeof executor.execute).toBe('function');
    });
  });

  describe('execute() happy path', () => {
    it('should parse the implementation plan from progressDir/implementation-plan.md', async () => {
      const ctx = makeCtx();
      await executor.execute(ctx);
      expect(
        (ctx.resultParser as never as { parseImplementationPlan: ReturnType<typeof vi.fn> }).parseImplementationPlan,
      ).toHaveBeenCalledWith(join('/tmp/progress', 'implementation-plan.md'));
    });

    it('should return path to implementation-plan.md', async () => {
      const ctx = makeCtx();
      const result = await executor.execute(ctx);
      expect(result).toBe(join('/tmp/progress', 'implementation-plan.md'));
    });

    it('should restore checkpoint state before processing tasks', async () => {
      const checkpoint = {
        getState: vi.fn().mockReturnValue({ completedTasks: ['task-001'], blockedTasks: [], currentPhase: 3 }),
        isTaskCompleted: vi.fn().mockReturnValue(false),
        startTask: vi.fn().mockResolvedValue(undefined),
        completeTask: vi.fn().mockResolvedValue(undefined),
        blockTask: vi.fn().mockResolvedValue(undefined),
      };
      const ctx = makeCtx({ checkpoint: checkpoint as never });
      const result = await executor.execute(ctx);
      // task-001 restored as complete → queue immediately done → no agents launched
      expect(result).toBe(join('/tmp/progress', 'implementation-plan.md'));
      expect(
        (ctx.launcher as never as { launchAgent: ReturnType<typeof vi.fn> }).launchAgent,
      ).not.toHaveBeenCalled();
    });

    it('should launch code-writer with correct arguments', async () => {
      const ctx = makeCtx();
      await executor.execute(ctx);
      expect(
        (ctx.launcher as never as { launchAgent: ReturnType<typeof vi.fn> }).launchAgent,
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          agent: 'code-writer',
          issueNumber: 42,
          phase: 3,
          taskId: 'task-001',
        }),
        '/tmp/worktree',
      );
    });

    it('should launch test-writer after code-writer succeeds', async () => {
      const ctx = makeCtx();
      await executor.execute(ctx);
      expect(
        (ctx.launcher as never as { launchAgent: ReturnType<typeof vi.fn> }).launchAgent,
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          agent: 'test-writer',
          issueNumber: 42,
          phase: 3,
          taskId: 'task-001',
        }),
        '/tmp/worktree',
      );
    });

    it('should launch code-reviewer after test-writer', async () => {
      const ctx = makeCtx();
      await executor.execute(ctx);
      expect(
        (ctx.launcher as never as { launchAgent: ReturnType<typeof vi.fn> }).launchAgent,
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          agent: 'code-reviewer',
          issueNumber: 42,
          phase: 3,
          taskId: 'task-001',
        }),
        '/tmp/worktree',
      );
    });

    it('should commit twice per successful task (intermediate + final)', async () => {
      const ctx = makeCtx();
      await executor.execute(ctx);
      expect(
        (ctx.commitManager as never as { commit: ReturnType<typeof vi.fn> }).commit,
      ).toHaveBeenCalledTimes(2);
    });

    it('should make intermediate commit before final task commit', async () => {
      const ctx = makeCtx();
      await executor.execute(ctx);
      const calls = (ctx.commitManager as never as { commit: ReturnType<typeof vi.fn> }).commit.mock.calls as [string, number, string][];
      expect(calls[0][0]).toMatch(/^wip:/);
      expect(calls[1][0]).toBe('implement Task task-001');
    });

    it('should mark task complete in checkpoint on success', async () => {
      const ctx = makeCtx();
      await executor.execute(ctx);
      expect(
        (ctx.checkpoint as never as { completeTask: ReturnType<typeof vi.fn> }).completeTask,
      ).toHaveBeenCalledWith('task-001');
    });

    it('should record tokens for code-writer, test-writer, and code-reviewer', async () => {
      const ctx = makeCtx();
      await executor.execute(ctx);
      expect(ctx.recordTokens).toHaveBeenCalledWith('code-writer', 50);
      expect(ctx.recordTokens).toHaveBeenCalledWith('test-writer', 50);
      expect(ctx.recordTokens).toHaveBeenCalledWith('code-reviewer', 50);
    });

    it('should log implementation completion with task counts', async () => {
      const ctx = makeCtx();
      await executor.execute(ctx);
      expect(
        (ctx.logger as never as { info: ReturnType<typeof vi.fn> }).info,
      ).toHaveBeenCalledWith(
        expect.stringContaining('Implementation complete'),
        expect.objectContaining({ issueNumber: 42, phase: 3 }),
      );
    });

    it('should write task plan slice to progressDir/task-{id}.md', async () => {
      const ctx = makeCtx();
      await executor.execute(ctx);
      expect(writeFile).toHaveBeenCalledWith(
        join('/tmp/progress', 'task-task-001.md'),
        expect.stringContaining('# Task: task-001'),
        'utf-8',
      );
    });

    it('should write diff to progressDir/diff-{id}.patch', async () => {
      const ctx = makeCtx();
      await executor.execute(ctx);
      expect(writeFile).toHaveBeenCalledWith(
        join('/tmp/progress', 'diff-task-001.patch'),
        expect.any(String),
        'utf-8',
      );
    });

    it('should append started and completed events to progress', async () => {
      const ctx = makeCtx();
      await executor.execute(ctx);
      expect(
        (ctx.progressWriter as never as { appendEvent: ReturnType<typeof vi.fn> }).appendEvent,
      ).toHaveBeenCalledWith(expect.stringContaining('task-001 started'));
      expect(
        (ctx.progressWriter as never as { appendEvent: ReturnType<typeof vi.fn> }).appendEvent,
      ).toHaveBeenCalledWith(expect.stringContaining('task-001 completed'));
    });

    it('should not throw if some tasks complete and some are blocked (sequential)', async () => {
      const tasks = [makeTask('task-001'), makeTask('task-002', ['task-001'])];
      const resultParser = {
        parseImplementationPlan: vi.fn().mockResolvedValue(tasks),
        parseReview: vi.fn().mockResolvedValue({ verdict: 'approved' }),
      };

      // First retryExecutor call (task-001) passes through; second (task-002) fails immediately
      let callCount = 0;
      const retryExecutor = {
        execute: vi.fn(async ({ fn }: { fn: (attempt: number) => Promise<unknown> }) => {
          callCount++;
          if (callCount === 1) {
            const result = await fn(1);
            return { success: true, result };
          }
          return { success: false, error: 'task-002 failed' };
        }),
      };

      const ctx = makeCtx({ resultParser: resultParser as never, retryExecutor: retryExecutor as never });
      // 1 completed, 1 blocked → should NOT throw
      await expect(executor.execute(ctx)).resolves.toBe(join('/tmp/progress', 'implementation-plan.md'));
    });
  });

  describe('execute() error handling', () => {
    it('should throw "All implementation tasks blocked" if all tasks are blocked', async () => {
      const retryExecutor = {
        execute: vi.fn().mockResolvedValue({ success: false, error: 'agent failed' }),
      };
      const ctx = makeCtx({ retryExecutor: retryExecutor as never });
      await expect(executor.execute(ctx)).rejects.toThrow('All implementation tasks blocked');
    });

    it('should throw if code-writer fails (causes task to be blocked)', async () => {
      const failResult: AgentResult = {
        agent: 'code-writer',
        success: false,
        exitCode: 1,
        timedOut: false,
        duration: 100,
        stdout: '',
        stderr: 'writer error',
        tokenUsage: null,
        outputPath: '',
        outputExists: false,
        error: 'writer error',
      };
      const launcher = { launchAgent: vi.fn().mockResolvedValue(failResult) };
      const ctx = makeCtx({ launcher: launcher as never });
      await expect(executor.execute(ctx)).rejects.toThrow('All implementation tasks blocked');
    });

    it('should throw when all tasks end up blocked (chain of failures)', async () => {
      // task-001 blocks → task-002 (dep on task-001) becomes ready (blocked deps count as satisfied)
      // → task-002 also blocks → queue complete with 0 completed → throw
      const tasks = [makeTask('task-001'), makeTask('task-002', ['task-001'])];
      const resultParser = {
        parseImplementationPlan: vi.fn().mockResolvedValue(tasks),
        parseReview: vi.fn().mockResolvedValue({ verdict: 'approved' }),
      };
      const retryExecutor = {
        execute: vi.fn().mockResolvedValue({ success: false, error: 'failed' }),
      };
      const ctx = makeCtx({ resultParser: resultParser as never, retryExecutor: retryExecutor as never });

      await expect(executor.execute(ctx)).rejects.toThrow('All implementation tasks blocked');
    });

    it('should mark task blocked in checkpoint when retryExecutor fails', async () => {
      const retryExecutor = {
        execute: vi.fn().mockResolvedValue({ success: false, error: 'max retries exceeded' }),
      };
      const ctx = makeCtx({ retryExecutor: retryExecutor as never });
      await expect(executor.execute(ctx)).rejects.toThrow();
      expect(
        (ctx.checkpoint as never as { blockTask: ReturnType<typeof vi.fn> }).blockTask,
      ).toHaveBeenCalledWith('task-001');
    });

    it('should propagate BudgetExceededError thrown inside the retry fn', async () => {
      const budgetError = new BudgetExceededError();
      const retryExecutor = {
        execute: vi.fn(async ({ fn }: { fn: (attempt: number) => Promise<unknown> }) => {
          try {
            await fn(1);
          } catch (err) {
            if (err instanceof BudgetExceededError) throw err;
            return { success: false, error: (err as Error).message };
          }
          return { success: true };
        }),
      };

      const checkBudget = vi.fn().mockImplementationOnce(() => { throw budgetError; });
      const ctx = makeCtx({ retryExecutor: retryExecutor as never, checkBudget });

      await expect(executor.execute(ctx)).rejects.toThrow('Per-issue token budget exceeded');
    });
  });

  describe('executeTask() fix-surgeon integration', () => {
    it('should launch fix-surgeon when review verdict is needs-fixes', async () => {
      vi.mocked(exists).mockResolvedValue(true);

      const launcher = {
        launchAgent: vi.fn()
          .mockResolvedValueOnce(makeSuccessAgentResult('code-writer'))
          .mockResolvedValueOnce(makeSuccessAgentResult('test-writer'))
          .mockResolvedValueOnce(makeSuccessAgentResult('code-reviewer'))
          .mockResolvedValueOnce(makeSuccessAgentResult('fix-surgeon')),
      };

      const resultParser = {
        parseImplementationPlan: vi.fn().mockResolvedValue([makeTask('task-001')]),
        parseReview: vi.fn().mockResolvedValue({ verdict: 'needs-fixes' }),
      };

      const ctx = makeCtx({ launcher: launcher as never, resultParser: resultParser as never });
      await executor.execute(ctx);

      expect(
        (ctx.launcher as never as { launchAgent: ReturnType<typeof vi.fn> }).launchAgent,
      ).toHaveBeenCalledWith(
        expect.objectContaining({ agent: 'fix-surgeon', issueNumber: 42, phase: 3, taskId: 'task-001' }),
        '/tmp/worktree',
      );
    });

    it('should not launch fix-surgeon when review verdict is approved', async () => {
      vi.mocked(exists).mockResolvedValue(true);

      const resultParser = {
        parseImplementationPlan: vi.fn().mockResolvedValue([makeTask('task-001')]),
        parseReview: vi.fn().mockResolvedValue({ verdict: 'approved' }),
      };

      const ctx = makeCtx({ resultParser: resultParser as never });
      await executor.execute(ctx);

      const launchCalls = (ctx.launcher as never as { launchAgent: ReturnType<typeof vi.fn> }).launchAgent.mock.calls;
      const agents = launchCalls.map((c: [{ agent: string }]) => c[0].agent);
      expect(agents).not.toContain('fix-surgeon');
    });

    it('should not launch fix-surgeon when review file does not exist', async () => {
      vi.mocked(exists).mockResolvedValue(false);

      const resultParser = {
        parseImplementationPlan: vi.fn().mockResolvedValue([makeTask('task-001')]),
        parseReview: vi.fn().mockResolvedValue({ verdict: 'needs-fixes' }),
      };

      const ctx = makeCtx({ resultParser: resultParser as never });
      await executor.execute(ctx);

      const launchCalls = (ctx.launcher as never as { launchAgent: ReturnType<typeof vi.fn> }).launchAgent.mock.calls;
      const agents = launchCalls.map((c: [{ agent: string }]) => c[0].agent);
      expect(agents).not.toContain('fix-surgeon');
      // parseReview should not be called if file doesn't exist
      expect(
        (ctx.resultParser as never as { parseReview: ReturnType<typeof vi.fn> }).parseReview,
      ).not.toHaveBeenCalled();
    });
  });

  describe('buildTaskPlanSlice', () => {
    it('should include task id and name as heading', async () => {
      const ctx = makeCtx();
      await executor.execute(ctx);
      const writeCalls = vi.mocked(writeFile).mock.calls;
      const planSliceCall = writeCalls.find(
        (c) => typeof c[0] === 'string' && (c[0] as string).includes('task-task-001.md'),
      );
      expect(planSliceCall).toBeDefined();
      expect(planSliceCall![1] as string).toContain('# Task: task-001 - Task task-001');
    });

    it('should include description, files, complexity, and acceptance criteria', async () => {
      const ctx = makeCtx();
      await executor.execute(ctx);
      const writeCalls = vi.mocked(writeFile).mock.calls;
      const planSliceCall = writeCalls.find(
        (c) => typeof c[0] === 'string' && (c[0] as string).includes('task-task-001.md'),
      );
      const content = planSliceCall![1] as string;
      expect(content).toContain('**Description:**');
      expect(content).toContain('**Files:**');
      expect(content).toContain('**Complexity:** simple');
      expect(content).toContain('**Acceptance Criteria:**');
      expect(content).toContain('- criterion 1');
    });

    it('should show "none" for tasks with no dependencies', async () => {
      const ctx = makeCtx();
      await executor.execute(ctx);
      const writeCalls = vi.mocked(writeFile).mock.calls;
      const planSliceCall = writeCalls.find(
        (c) => typeof c[0] === 'string' && (c[0] as string).includes('task-task-001.md'),
      );
      expect(planSliceCall![1] as string).toContain('**Dependencies:** none');
    });

    it('should list dependency ids for tasks with dependencies', async () => {
      const tasks = [makeTask('task-001'), makeTask('task-002', ['task-001'])];
      const resultParser = {
        parseImplementationPlan: vi.fn().mockResolvedValue(tasks),
        parseReview: vi.fn().mockResolvedValue({ verdict: 'approved' }),
      };

      let secondTaskPlanContent: string | undefined;
      vi.mocked(writeFile).mockImplementation(async (path, data) => {
        if (typeof path === 'string' && path.includes('task-task-002.md')) {
          secondTaskPlanContent = data as string;
        }
      });

      // Task-002 depends on task-001; give launcher enough mocked results for both tasks
      const launcher = {
        launchAgent: vi.fn()
          .mockResolvedValueOnce(makeSuccessAgentResult('code-writer'))
          .mockResolvedValueOnce(makeSuccessAgentResult('test-writer'))
          .mockResolvedValueOnce(makeSuccessAgentResult('code-reviewer'))
          .mockResolvedValueOnce(makeSuccessAgentResult('code-writer'))
          .mockResolvedValueOnce(makeSuccessAgentResult('test-writer'))
          .mockResolvedValueOnce(makeSuccessAgentResult('code-reviewer')),
      };

      const ctx = makeCtx({ resultParser: resultParser as never, launcher: launcher as never });
      await executor.execute(ctx);
      expect(secondTaskPlanContent).toBeDefined();
      expect(secondTaskPlanContent).toContain('**Dependencies:** task-001');
    });
  });

  describe('getTaskDiff and intermediate commit', () => {
    it('should call getTaskDiff() to capture the diff for the reviewer', async () => {
      const ctx = makeCtx();
      await executor.execute(ctx);
      expect(
        (ctx.commitManager as never as { getTaskDiff: ReturnType<typeof vi.fn> }).getTaskDiff,
      ).toHaveBeenCalled();
    });

    it('should NOT call getDiff() for the reviewer diff', async () => {
      const commitManager = {
        getChangedFiles: vi.fn().mockResolvedValue([]),
        getTaskDiff: vi.fn().mockResolvedValue('task diff'),
        getDiff: vi.fn().mockResolvedValue('full diff'),
        commit: vi.fn().mockResolvedValue(undefined),
      };
      const ctx = makeCtx({ commitManager: commitManager as never });
      await executor.execute(ctx);
      expect(commitManager.getDiff).not.toHaveBeenCalled();
    });

    it('should write the result of getTaskDiff() to the diff patch file', async () => {
      const commitManager = {
        getChangedFiles: vi.fn().mockResolvedValue([]),
        getTaskDiff: vi.fn().mockResolvedValue('my-task-specific-diff'),
        commit: vi.fn().mockResolvedValue(undefined),
      };
      const ctx = makeCtx({ commitManager: commitManager as never });
      await executor.execute(ctx);
      expect(writeFile).toHaveBeenCalledWith(
        join('/tmp/progress', 'diff-task-001.patch'),
        'my-task-specific-diff',
        'utf-8',
      );
    });

    it('should commit intermediate work before launching code-reviewer', async () => {
      const callOrder: string[] = [];
      const commitManager = {
        getChangedFiles: vi.fn().mockResolvedValue([]),
        getTaskDiff: vi.fn().mockResolvedValue(''),
        commit: vi.fn(async (msg: string) => { callOrder.push(`commit:${msg}`); }),
      };
      const launcher = {
        launchAgent: vi.fn(async ({ agent }: { agent: string }) => {
          callOrder.push(`launch:${agent}`);
          return makeSuccessAgentResult(agent);
        }),
      };
      const ctx = makeCtx({ commitManager: commitManager as never, launcher: launcher as never });
      await executor.execute(ctx);

      const reviewerIndex = callOrder.indexOf('launch:code-reviewer');
      const intermediateCommitIndex = callOrder.findIndex((e) => e.startsWith('commit:wip:'));
      expect(intermediateCommitIndex).toBeGreaterThanOrEqual(0);
      expect(intermediateCommitIndex).toBeLessThan(reviewerIndex);
    });

    it('should use wip: prefix with task name and attempt number in intermediate commit message', async () => {
      const ctx = makeCtx();
      await executor.execute(ctx);
      const calls = (ctx.commitManager as never as { commit: ReturnType<typeof vi.fn> }).commit.mock.calls as [string, number, string][];
      const intermediateCall = calls.find(([msg]) => msg.startsWith('wip:'));
      expect(intermediateCall).toBeDefined();
      expect(intermediateCall![0]).toContain('Task task-001');
      expect(intermediateCall![0]).toMatch(/attempt \d+/);
      expect(intermediateCall![1]).toBe(42);
      expect(intermediateCall![2]).toBe('feat');
    });

    it('should commit after test-writer and before code-reviewer', async () => {
      const callOrder: string[] = [];
      const commitManager = {
        getChangedFiles: vi.fn().mockResolvedValue([]),
        getTaskDiff: vi.fn().mockResolvedValue(''),
        commit: vi.fn(async (msg: string) => { callOrder.push(`commit:${msg}`); }),
      };
      const launcher = {
        launchAgent: vi.fn(async ({ agent }: { agent: string }) => {
          callOrder.push(`launch:${agent}`);
          return makeSuccessAgentResult(agent);
        }),
      };
      const ctx = makeCtx({ commitManager: commitManager as never, launcher: launcher as never });
      await executor.execute(ctx);

      const testWriterIndex = callOrder.indexOf('launch:test-writer');
      const reviewerIndex = callOrder.indexOf('launch:code-reviewer');
      const intermediateCommitIndex = callOrder.findIndex((e) => e.startsWith('commit:wip:'));
      expect(intermediateCommitIndex).toBeGreaterThan(testWriterIndex);
      expect(intermediateCommitIndex).toBeLessThan(reviewerIndex);
    });
  });

  describe('truncateDiff integration', () => {
    it('should write diff unchanged when diff is within 200,000 character limit', async () => {
      const shortDiff = 'a'.repeat(100);
      const commitManager = {
        getChangedFiles: vi.fn().mockResolvedValue([]),
        getTaskDiff: vi.fn().mockResolvedValue(shortDiff),
        commit: vi.fn().mockResolvedValue(undefined),
      };
      const ctx = makeCtx({ commitManager: commitManager as never });
      await executor.execute(ctx);
      expect(writeFile).toHaveBeenCalledWith(
        join('/tmp/progress', 'diff-task-001.patch'),
        shortDiff,
        'utf-8',
      );
    });

    it('should write diff unchanged when diff is exactly 200,000 characters', async () => {
      const exactDiff = 'x'.repeat(200_000);
      const commitManager = {
        getChangedFiles: vi.fn().mockResolvedValue([]),
        getTaskDiff: vi.fn().mockResolvedValue(exactDiff),
        commit: vi.fn().mockResolvedValue(undefined),
      };
      const ctx = makeCtx({ commitManager: commitManager as never });
      await executor.execute(ctx);
      expect(writeFile).toHaveBeenCalledWith(
        join('/tmp/progress', 'diff-task-001.patch'),
        exactDiff,
        'utf-8',
      );
    });

    it('should truncate diff to 200,000 chars when diff exceeds limit', async () => {
      const largeDiff = 'y'.repeat(300_000);
      const commitManager = {
        getChangedFiles: vi.fn().mockResolvedValue([]),
        getTaskDiff: vi.fn().mockResolvedValue(largeDiff),
        commit: vi.fn().mockResolvedValue(undefined),
      };
      const ctx = makeCtx({ commitManager: commitManager as never });
      await executor.execute(ctx);
      const patchCall = vi.mocked(writeFile).mock.calls.find(
        (c) => typeof c[0] === 'string' && (c[0] as string).endsWith('diff-task-001.patch'),
      );
      expect(patchCall).toBeDefined();
      const written = patchCall![1] as string;
      expect(written.startsWith('y'.repeat(200_000))).toBe(true);
      expect(written).toContain('[Diff truncated: exceeded 200,000 character limit]');
    });

    it('should append truncation notice when diff is truncated', async () => {
      const largeDiff = 'z'.repeat(250_000);
      const commitManager = {
        getChangedFiles: vi.fn().mockResolvedValue([]),
        getTaskDiff: vi.fn().mockResolvedValue(largeDiff),
        commit: vi.fn().mockResolvedValue(undefined),
      };
      const ctx = makeCtx({ commitManager: commitManager as never });
      await executor.execute(ctx);
      const patchCall = vi.mocked(writeFile).mock.calls.find(
        (c) => typeof c[0] === 'string' && (c[0] as string).endsWith('diff-task-001.patch'),
      );
      const written = patchCall![1] as string;
      expect(written).toMatch(/\[Diff truncated: exceeded 200,000 character limit\]/);
    });

    it('should not include characters beyond 200,000 from original diff when truncated', async () => {
      const prefix = 'a'.repeat(200_000);
      const suffix = 'b'.repeat(50_000);
      const largeDiff = prefix + suffix;
      const commitManager = {
        getChangedFiles: vi.fn().mockResolvedValue([]),
        getTaskDiff: vi.fn().mockResolvedValue(largeDiff),
        commit: vi.fn().mockResolvedValue(undefined),
      };
      const ctx = makeCtx({ commitManager: commitManager as never });
      await executor.execute(ctx);
      const patchCall = vi.mocked(writeFile).mock.calls.find(
        (c) => typeof c[0] === 'string' && (c[0] as string).endsWith('diff-task-001.patch'),
      );
      const written = patchCall![1] as string;
      // The suffix characters should not appear in the written diff
      expect(written).not.toContain('b');
    });
  });

  describe('retryExecutor integration', () => {
    it('should pass maxRetriesPerTask from config as maxAttempts', async () => {
      const retryExecutor = {
        execute: vi.fn(async ({ fn }: { fn: (attempt: number) => Promise<unknown> }) => {
          const result = await fn(1);
          return { success: true, result };
        }),
      };

      const ctx = makeCtx({ retryExecutor: retryExecutor as never });
      await executor.execute(ctx);

      expect(retryExecutor.execute).toHaveBeenCalledWith(
        expect.objectContaining({ maxAttempts: 3 }),
      );
    });

    it('should use task id and name in retryExecutor description', async () => {
      const descriptions: string[] = [];
      const retryExecutor = {
        execute: vi.fn(
          async ({ fn, description }: { fn: (attempt: number) => Promise<unknown>; description: string }) => {
            descriptions.push(description);
            const result = await fn(1);
            return { success: true, result };
          },
        ),
      };

      const ctx = makeCtx({ retryExecutor: retryExecutor as never });
      await executor.execute(ctx);

      expect(descriptions.some((d) => d.includes('task-001') && d.includes('Task task-001'))).toBe(true);
    });
  });
});
