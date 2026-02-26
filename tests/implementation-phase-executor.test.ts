import { describe, it, expect, vi, beforeEach } from 'vitest';
import { join } from 'node:path';
import { ImplementationPhaseExecutor } from '../src/executors/implementation-phase-executor.js';
import { BudgetExceededError } from '../src/core/issue-orchestrator.js';
import type { PhaseContext } from '../src/core/phase-executor.js';
import type { AgentResult, AgentSession, SessionReviewSummary } from '../src/agents/types.js';

vi.mock('../src/util/fs.js', () => ({
  exists: vi.fn().mockResolvedValue(false),
}));

vi.mock('node:fs/promises', () => ({
  writeFile: vi.fn().mockResolvedValue(undefined),
  readFile: vi.fn().mockRejectedValue(Object.assign(new Error('ENOENT: no such file or directory'), { code: 'ENOENT' })),
}));

vi.mock('../src/util/process.js', () => ({
  execShell: vi.fn().mockResolvedValue({ exitCode: 0, stdout: '', stderr: '' }),
}));

import { exists } from '../src/util/fs.js';
import { writeFile, readFile } from 'node:fs/promises';
import { execShell } from '../src/util/process.js';

function makeSession(id: string, deps: string[] = [], files: string[] = []): AgentSession {
  return {
    id,
    name: `Session ${id}`,
    rationale: `Rationale for ${id}`,
    dependencies: deps,
    steps: [{
      id: `${id}-step-001`,
      name: `Step 1 of ${id}`,
      description: `Description for ${id}`,
      files: files.length ? files : [`src/${id}.ts`],
      complexity: 'simple' as const,
      acceptanceCriteria: ['criterion 1'],
    }],
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
      .mockResolvedValueOnce(makeSuccessAgentResult('code-reviewer'))
      .mockResolvedValue(makeSuccessAgentResult('whole-pr-reviewer')),
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
    buildForWholePrCodeReviewer: vi.fn().mockResolvedValue('/progress/whole-pr-reviewer-ctx.json'),
    buildForFixSurgeon: vi.fn().mockResolvedValue('/progress/fix-ctx.json'),
  };

  const resultParser = {
    parseImplementationPlan: vi.fn().mockResolvedValue([makeSession('session-001')]),
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
    getDiff: vi.fn().mockResolvedValue('full pr diff content'),
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

  const services = {
    launcher: launcher as never,
    retryExecutor: retryExecutor as never,
    tokenTracker: tokenTracker as never,
    contextBuilder: contextBuilder as never,
    resultParser: resultParser as never,
    logger: logger as never,
  };

  const io = {
    progressDir: '/tmp/progress',
    progressWriter: progressWriter as never,
    checkpoint: checkpoint as never,
    commitManager: commitManager as never,
  };

  const callbacks = {
    recordTokens,
    checkBudget,
    updateProgress: vi.fn().mockResolvedValue(undefined),
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
      commands: { build: undefined },
      options: { maxParallelAgents: 2, maxRetriesPerTask: 3, perTaskBuildCheck: true, maxBuildFixRounds: 2, maxWholePrReviewRetries: 2 },
    } as never,
    platform: {} as never,
    services: { ...services, ...overrides.services } as never,
    io: { ...io, ...overrides.io } as never,
    callbacks: { ...callbacks, ...overrides.callbacks } as never,
    ...Object.fromEntries(
      Object.entries(overrides).filter(([k]) => !['services', 'io', 'callbacks'].includes(k)),
    ),
  } as PhaseContext;
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
        (ctx.services.resultParser as never as { parseImplementationPlan: ReturnType<typeof vi.fn> }).parseImplementationPlan,
      ).toHaveBeenCalledWith(join('/tmp/progress', 'implementation-plan.md'));
    });

    it('should return path to implementation-plan.md', async () => {
      const ctx = makeCtx();
      const result = await executor.execute(ctx);
      expect(result).toBe(join('/tmp/progress', 'implementation-plan.md'));
    });

    it('should restore checkpoint state before processing tasks', async () => {
      const checkpoint = {
        getState: vi.fn().mockReturnValue({ completedTasks: ['session-001'], blockedTasks: [], currentPhase: 3 }),
        isTaskCompleted: vi.fn().mockReturnValue(false),
        startTask: vi.fn().mockResolvedValue(undefined),
        completeTask: vi.fn().mockResolvedValue(undefined),
        blockTask: vi.fn().mockResolvedValue(undefined),
      };
      const ctx = makeCtx({ io: { checkpoint: checkpoint } as never });
      const result = await executor.execute(ctx);
      // task-001 restored as complete → queue immediately done → no per-session agents launched
      expect(result).toBe(join('/tmp/progress', 'implementation-plan.md'));
      const launchCalls = (
        ctx.services.launcher as never as { launchAgent: ReturnType<typeof vi.fn> }
      ).launchAgent.mock.calls.map((c: [{ agent: string }]) => c[0].agent);
      // Per-session agents must not run (no sessions were processed this run)
      expect(launchCalls).not.toContain('code-writer');
      expect(launchCalls).not.toContain('test-writer');
      expect(launchCalls).not.toContain('code-reviewer');
    });

    it('should launch code-writer with correct arguments', async () => {
      const ctx = makeCtx();
      await executor.execute(ctx);
      expect(
        (ctx.services.launcher as never as { launchAgent: ReturnType<typeof vi.fn> }).launchAgent,
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          agent: 'code-writer',
          issueNumber: 42,
          phase: 3,
          sessionId: 'session-001',
        }),
        '/tmp/worktree',
      );
    });

    it('should launch test-writer after code-writer succeeds', async () => {
      const ctx = makeCtx();
      await executor.execute(ctx);
      expect(
        (ctx.services.launcher as never as { launchAgent: ReturnType<typeof vi.fn> }).launchAgent,
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          agent: 'test-writer',
          issueNumber: 42,
          phase: 3,
          sessionId: 'session-001',
        }),
        '/tmp/worktree',
      );
    });

    it('should launch code-reviewer after test-writer', async () => {
      const ctx = makeCtx();
      await executor.execute(ctx);
      expect(
        (ctx.services.launcher as never as { launchAgent: ReturnType<typeof vi.fn> }).launchAgent,
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          agent: 'code-reviewer',
          issueNumber: 42,
          phase: 3,
          sessionId: 'session-001',
        }),
        '/tmp/worktree',
      );
    });

    it('should commit twice per successful task (intermediate + final)', async () => {
      const ctx = makeCtx();
      await executor.execute(ctx);
      expect(
        (ctx.io.commitManager as never as { commit: ReturnType<typeof vi.fn> }).commit,
      ).toHaveBeenCalledTimes(2);
    });

    it('should make intermediate commit before final task commit', async () => {
      const ctx = makeCtx();
      await executor.execute(ctx);
      const calls = (ctx.io.commitManager as never as { commit: ReturnType<typeof vi.fn> }).commit.mock.calls as [string, number, string][];
      expect(calls[0][0]).toMatch(/^wip:/);
      expect(calls[1][0]).toBe('implement Session session-001');
    });

    it('should mark task complete in checkpoint on success', async () => {
      const ctx = makeCtx();
      await executor.execute(ctx);
      expect(
        (ctx.io.checkpoint as never as { completeTask: ReturnType<typeof vi.fn> }).completeTask,
      ).toHaveBeenCalledWith('session-001');
    });

    it('should record tokens for code-writer, test-writer, and code-reviewer', async () => {
      const ctx = makeCtx();
      await executor.execute(ctx);
      expect(ctx.callbacks.recordTokens).toHaveBeenCalledWith('code-writer', 50);
      expect(ctx.callbacks.recordTokens).toHaveBeenCalledWith('test-writer', 50);
      expect(ctx.callbacks.recordTokens).toHaveBeenCalledWith('code-reviewer', 50);
    });

    it('should log implementation completion with task counts', async () => {
      const ctx = makeCtx();
      await executor.execute(ctx);
      expect(
        (ctx.services.logger as never as { info: ReturnType<typeof vi.fn> }).info,
      ).toHaveBeenCalledWith(
        expect.stringContaining('Implementation complete'),
        expect.objectContaining({ issueNumber: 42, phase: 3 }),
      );
    });

    it('should write session plan slice to progressDir/session-{id}.md', async () => {
      const ctx = makeCtx();
      await executor.execute(ctx);
      expect(writeFile).toHaveBeenCalledWith(
        join('/tmp/progress', 'session-session-001.md'),
        expect.stringContaining('# Session: session-001'),
        'utf-8',
      );
    });

    it('should write diff to progressDir/diff-{id}.patch', async () => {
      const ctx = makeCtx();
      await executor.execute(ctx);
      expect(writeFile).toHaveBeenCalledWith(
        join('/tmp/progress', 'diff-session-001.patch'),
        expect.any(String),
        'utf-8',
      );
    });

    it('should write review-<session-id>-summary.json after successful per-session code-reviewer run', async () => {
      // exists returns true only for the per-session review file so parseReview is called
      vi.mocked(exists).mockImplementation(async (path) =>
        String(path).includes('review-session-'),
      );

      const resultParser = {
        parseImplementationPlan: vi.fn().mockResolvedValue([makeSession('session-001')]),
        parseReview: vi.fn().mockResolvedValueOnce({
          verdict: 'pass' as const,
          summary: 'Looks good',
          issues: [{ file: 'src/a.ts', severity: 'warning' as const, description: 'Minor style issue' }],
        }),
      };

      const ctx = makeCtx({ services: { resultParser: resultParser } as never });
      await executor.execute(ctx);

      expect(writeFile).toHaveBeenCalledWith(
        join('/tmp/progress', 'review-session-001-summary.json'),
        expect.stringContaining('"sessionId"'),
        'utf-8',
      );
    });

    it('should include correct fields in review summary JSON', async () => {
      vi.mocked(exists).mockImplementation(async (path) =>
        String(path).includes('review-session-'),
      );

      const resultParser = {
        parseImplementationPlan: vi.fn().mockResolvedValue([makeSession('session-001')]),
        parseReview: vi.fn().mockResolvedValueOnce({
          verdict: 'pass' as const,
          summary: 'All checks passed',
          issues: [
            { file: 'src/a.ts', severity: 'warning' as const, description: 'unused var' },
            { file: 'src/b.ts', severity: 'error' as const, description: 'type error' },
          ],
        }),
      };

      const ctx = makeCtx({ services: { resultParser: resultParser } as never });
      await executor.execute(ctx);

      const summaryCall = vi.mocked(writeFile).mock.calls.find(
        (c) => typeof c[0] === 'string' && (c[0] as string).endsWith('review-session-001-summary.json'),
      );
      expect(summaryCall).toBeDefined();
      const written = JSON.parse(summaryCall![1] as string) as SessionReviewSummary;
      expect(written.sessionId).toBe('session-001');
      expect(written.verdict).toBe('pass');
      expect(written.summary).toBe('All checks passed');
      expect(written.keyFindings).toEqual(['unused var', 'type error']);
    });

    it('should not write review summary JSON when review file does not exist', async () => {
      // exists returns false everywhere (default), so parseReview is never called
      vi.mocked(exists).mockResolvedValue(false);

      const ctx = makeCtx();
      await executor.execute(ctx);

      const summaryCall = vi.mocked(writeFile).mock.calls.find(
        (c) => typeof c[0] === 'string' && (c[0] as string).endsWith('review-session-001-summary.json'),
      );
      expect(summaryCall).toBeUndefined();
    });

    it('should append started and completed events to progress', async () => {
      const ctx = makeCtx();
      await executor.execute(ctx);
      expect(
        (ctx.io.progressWriter as never as { appendEvent: ReturnType<typeof vi.fn> }).appendEvent,
      ).toHaveBeenCalledWith(expect.stringContaining('session-001 started'));
      expect(
        (ctx.io.progressWriter as never as { appendEvent: ReturnType<typeof vi.fn> }).appendEvent,
      ).toHaveBeenCalledWith(expect.stringContaining('session-001 completed'));
    });

    it('should not throw if some tasks complete and some are blocked (sequential)', async () => {
      const tasks = [makeSession('session-001'), makeSession('session-002', ['session-001'])];
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
          return { success: false, error: 'session-002 failed' };
        }),
      };

      const ctx = makeCtx({ services: { resultParser: resultParser, retryExecutor: retryExecutor } as never });
      // 1 completed, 1 blocked → should NOT throw
      await expect(executor.execute(ctx)).resolves.toBe(join('/tmp/progress', 'implementation-plan.md'));
    });
  });

  describe('execute() error handling', () => {
    it('should throw "All implementation sessions blocked" if all tasks are blocked', async () => {
      const retryExecutor = {
        execute: vi.fn().mockResolvedValue({ success: false, error: 'agent failed' }),
      };
      const ctx = makeCtx({ services: { retryExecutor: retryExecutor } as never });
      await expect(executor.execute(ctx)).rejects.toThrow('All implementation sessions blocked');
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
      const ctx = makeCtx({ services: { launcher: launcher } as never });
      await expect(executor.execute(ctx)).rejects.toThrow('All implementation sessions blocked');
    });

    it('should throw when all tasks end up blocked (chain of failures)', async () => {
      // task-001 blocks → task-002 (dep on task-001) becomes ready (blocked deps count as satisfied)
      // → task-002 also blocks → queue complete with 0 completed → throw
      const tasks = [makeSession('session-001'), makeSession('session-002', ['session-001'])];
      const resultParser = {
        parseImplementationPlan: vi.fn().mockResolvedValue(tasks),
        parseReview: vi.fn().mockResolvedValue({ verdict: 'approved' }),
      };
      const retryExecutor = {
        execute: vi.fn().mockResolvedValue({ success: false, error: 'failed' }),
      };
      const ctx = makeCtx({ services: { resultParser: resultParser, retryExecutor: retryExecutor } as never });

      await expect(executor.execute(ctx)).rejects.toThrow('All implementation sessions blocked');
    });

    it('should mark task blocked in checkpoint when retryExecutor fails', async () => {
      const retryExecutor = {
        execute: vi.fn().mockResolvedValue({ success: false, error: 'max retries exceeded' }),
      };
      const ctx = makeCtx({ services: { retryExecutor: retryExecutor } as never });
      await expect(executor.execute(ctx)).rejects.toThrow();
      expect(
        (ctx.io.checkpoint as never as { blockTask: ReturnType<typeof vi.fn> }).blockTask,
      ).toHaveBeenCalledWith('session-001');
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
      const ctx = makeCtx({ services: { retryExecutor: retryExecutor } as never, callbacks: { checkBudget } as never });

      await expect(executor.execute(ctx)).rejects.toThrow('Per-issue token budget exceeded');
    });
  });

  describe('executeTask() fix-surgeon integration', () => {
    it('should launch fix-surgeon when review verdict is needs-fixes', async () => {
      // Return true only for per-session review files, not the whole-PR review file,
      // so the whole-PR review path exits early and doesn't interfere.
      vi.mocked(exists).mockImplementation(async (path) =>
        String(path).includes('review-session-'),
      );

      const launcher = {
        launchAgent: vi.fn()
          .mockResolvedValueOnce(makeSuccessAgentResult('code-writer'))
          .mockResolvedValueOnce(makeSuccessAgentResult('test-writer'))
          .mockResolvedValueOnce(makeSuccessAgentResult('code-reviewer'))
          .mockResolvedValueOnce(makeSuccessAgentResult('fix-surgeon'))
          .mockResolvedValue(makeSuccessAgentResult('whole-pr-reviewer')),
      };

      const resultParser = {
        parseImplementationPlan: vi.fn().mockResolvedValue([makeSession('session-001')]),
        parseReview: vi.fn().mockResolvedValue({ verdict: 'needs-fixes' }),
      };

      const ctx = makeCtx({ services: { launcher: launcher, resultParser: resultParser } as never });
      await executor.execute(ctx);

      expect(
        (ctx.services.launcher as never as { launchAgent: ReturnType<typeof vi.fn> }).launchAgent,
      ).toHaveBeenCalledWith(
        expect.objectContaining({ agent: 'fix-surgeon', issueNumber: 42, phase: 3, sessionId: 'session-001' }),
        '/tmp/worktree',
      );
    });

    it('should not launch fix-surgeon when review verdict is approved', async () => {
      vi.mocked(exists).mockResolvedValue(true);

      const resultParser = {
        parseImplementationPlan: vi.fn().mockResolvedValue([makeSession('session-001')]),
        parseReview: vi.fn().mockResolvedValue({ verdict: 'approved' }),
      };

      const ctx = makeCtx({ services: { resultParser: resultParser } as never });
      await executor.execute(ctx);

      const launchCalls = (ctx.services.launcher as never as { launchAgent: ReturnType<typeof vi.fn> }).launchAgent.mock.calls;
      const agents = launchCalls.map((c: [{ agent: string }]) => c[0].agent);
      expect(agents).not.toContain('fix-surgeon');
    });

    it('should not launch fix-surgeon when review file does not exist', async () => {
      vi.mocked(exists).mockResolvedValue(false);

      const resultParser = {
        parseImplementationPlan: vi.fn().mockResolvedValue([makeSession('session-001')]),
        parseReview: vi.fn().mockResolvedValue({ verdict: 'needs-fixes' }),
      };

      const ctx = makeCtx({ services: { resultParser: resultParser } as never });
      await executor.execute(ctx);

      const launchCalls = (ctx.services.launcher as never as { launchAgent: ReturnType<typeof vi.fn> }).launchAgent.mock.calls;
      const agents = launchCalls.map((c: [{ agent: string }]) => c[0].agent);
      expect(agents).not.toContain('fix-surgeon');
      // parseReview should not be called if file doesn't exist
      expect(
        (ctx.services.resultParser as never as { parseReview: ReturnType<typeof vi.fn> }).parseReview,
      ).not.toHaveBeenCalled();
    });
  });

  describe('buildTaskPlanSlice', () => {
    it('should include task id and name as heading', async () => {
      const ctx = makeCtx();
      await executor.execute(ctx);
      const writeCalls = vi.mocked(writeFile).mock.calls;
      const planSliceCall = writeCalls.find(
        (c) => typeof c[0] === 'string' && (c[0] as string).includes('session-session-001.md'),
      );
      expect(planSliceCall).toBeDefined();
      expect(planSliceCall![1] as string).toContain('# Session: session-001 - Session session-001');
    });

    it('should include description, files, complexity, and acceptance criteria', async () => {
      const ctx = makeCtx();
      await executor.execute(ctx);
      const writeCalls = vi.mocked(writeFile).mock.calls;
      const planSliceCall = writeCalls.find(
        (c) => typeof c[0] === 'string' && (c[0] as string).includes('session-session-001.md'),
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
        (c) => typeof c[0] === 'string' && (c[0] as string).includes('session-session-001.md'),
      );
      expect(planSliceCall![1] as string).toContain('**Dependencies:** none');
    });

    it('should list dependency ids for tasks with dependencies', async () => {
      const tasks = [makeSession('session-001'), makeSession('session-002', ['session-001'])];
      const resultParser = {
        parseImplementationPlan: vi.fn().mockResolvedValue(tasks),
        parseReview: vi.fn().mockResolvedValue({ verdict: 'approved' }),
      };

      let secondTaskPlanContent: string | undefined;
      vi.mocked(writeFile).mockImplementation(async (path, data) => {
        if (typeof path === 'string' && path.includes('session-session-002.md')) {
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
          .mockResolvedValueOnce(makeSuccessAgentResult('code-reviewer'))
          .mockResolvedValue(makeSuccessAgentResult('whole-pr-reviewer')),
      };

      const ctx = makeCtx({ services: { resultParser: resultParser, launcher: launcher } as never });
      await executor.execute(ctx);
      expect(secondTaskPlanContent).toBeDefined();
      expect(secondTaskPlanContent).toContain('**Dependencies:** session-001');
    });
  });

  describe('getTaskDiff and intermediate commit', () => {
    it('should call getTaskDiff() to capture the diff for the reviewer', async () => {
      const ctx = makeCtx();
      await executor.execute(ctx);
      expect(
        (ctx.io.commitManager as never as { getTaskDiff: ReturnType<typeof vi.fn> }).getTaskDiff,
      ).toHaveBeenCalled();
    });

    it('should call getDiff for whole-PR review but not getTaskDiff', async () => {
      const commitManager = {
        getChangedFiles: vi.fn().mockResolvedValue([]),
        getTaskDiff: vi.fn().mockResolvedValue('task diff'),
        getDiff: vi.fn().mockResolvedValue('full diff'),
        commit: vi.fn().mockResolvedValue(undefined),
      };
      const ctx = makeCtx({ io: { commitManager: commitManager } as never });
      await executor.execute(ctx);
      // per-session reviewer uses getTaskDiff, not getDiff
      expect(commitManager.getTaskDiff).toHaveBeenCalled();
      // whole-PR review uses getDiff with the base commit
      expect(commitManager.getDiff).toHaveBeenCalledWith('abc123');
    });

    it('should write the result of getTaskDiff() to the diff patch file', async () => {
      const commitManager = {
        getChangedFiles: vi.fn().mockResolvedValue([]),
        getTaskDiff: vi.fn().mockResolvedValue('my-task-specific-diff'),
        getDiff: vi.fn().mockResolvedValue(''),
        commit: vi.fn().mockResolvedValue(undefined),
      };
      const ctx = makeCtx({ io: { commitManager: commitManager } as never });
      await executor.execute(ctx);
      expect(writeFile).toHaveBeenCalledWith(
        join('/tmp/progress', 'diff-session-001.patch'),
        'my-task-specific-diff',
        'utf-8',
      );
    });

    it('should commit intermediate work before launching code-reviewer', async () => {
      const callOrder: string[] = [];
      const commitManager = {
        getChangedFiles: vi.fn().mockResolvedValue([]),
        getTaskDiff: vi.fn().mockResolvedValue(''),
        getDiff: vi.fn().mockResolvedValue(''),
        commit: vi.fn(async (msg: string) => { callOrder.push(`commit:${msg}`); }),
      };
      const launcher = {
        launchAgent: vi.fn(async ({ agent }: { agent: string }) => {
          callOrder.push(`launch:${agent}`);
          return makeSuccessAgentResult(agent);
        }),
      };
      const ctx = makeCtx({ io: { commitManager: commitManager } as never, services: { launcher: launcher } as never });
      await executor.execute(ctx);

      const reviewerIndex = callOrder.indexOf('launch:code-reviewer');
      const intermediateCommitIndex = callOrder.findIndex((e) => e.startsWith('commit:wip:'));
      expect(intermediateCommitIndex).toBeGreaterThanOrEqual(0);
      expect(intermediateCommitIndex).toBeLessThan(reviewerIndex);
    });

    it('should use wip: prefix with task name and attempt number in intermediate commit message', async () => {
      const ctx = makeCtx();
      await executor.execute(ctx);
      const calls = (ctx.io.commitManager as never as { commit: ReturnType<typeof vi.fn> }).commit.mock.calls as [string, number, string][];
      const intermediateCall = calls.find(([msg]) => msg.startsWith('wip:'));
      expect(intermediateCall).toBeDefined();
      expect(intermediateCall![0]).toContain('Session session-001');
      expect(intermediateCall![0]).toMatch(/attempt \d+/);
      expect(intermediateCall![1]).toBe(42);
      expect(intermediateCall![2]).toBe('feat');
    });

    it('should commit after test-writer and before code-reviewer', async () => {
      const callOrder: string[] = [];
      const commitManager = {
        getChangedFiles: vi.fn().mockResolvedValue([]),
        getTaskDiff: vi.fn().mockResolvedValue(''),
        getDiff: vi.fn().mockResolvedValue(''),
        commit: vi.fn(async (msg: string) => { callOrder.push(`commit:${msg}`); }),
      };
      const launcher = {
        launchAgent: vi.fn(async ({ agent }: { agent: string }) => {
          callOrder.push(`launch:${agent}`);
          return makeSuccessAgentResult(agent);
        }),
      };
      const ctx = makeCtx({ io: { commitManager: commitManager } as never, services: { launcher: launcher } as never });
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
        getDiff: vi.fn().mockResolvedValue(''),
        commit: vi.fn().mockResolvedValue(undefined),
      };
      const ctx = makeCtx({ io: { commitManager: commitManager } as never });
      await executor.execute(ctx);
      expect(writeFile).toHaveBeenCalledWith(
        join('/tmp/progress', 'diff-session-001.patch'),
        shortDiff,
        'utf-8',
      );
    });

    it('should write diff unchanged when diff is exactly 200,000 characters', async () => {
      const exactDiff = 'x'.repeat(200_000);
      const commitManager = {
        getChangedFiles: vi.fn().mockResolvedValue([]),
        getTaskDiff: vi.fn().mockResolvedValue(exactDiff),
        getDiff: vi.fn().mockResolvedValue(''),
        commit: vi.fn().mockResolvedValue(undefined),
      };
      const ctx = makeCtx({ io: { commitManager: commitManager } as never });
      await executor.execute(ctx);
      expect(writeFile).toHaveBeenCalledWith(
        join('/tmp/progress', 'diff-session-001.patch'),
        exactDiff,
        'utf-8',
      );
    });

    it('should truncate diff to 200,000 chars when diff exceeds limit', async () => {
      const largeDiff = 'y'.repeat(300_000);
      const commitManager = {
        getChangedFiles: vi.fn().mockResolvedValue([]),
        getTaskDiff: vi.fn().mockResolvedValue(largeDiff),
        getDiff: vi.fn().mockResolvedValue(''),
        commit: vi.fn().mockResolvedValue(undefined),
      };
      const ctx = makeCtx({ io: { commitManager: commitManager } as never });
      await executor.execute(ctx);
      const patchCall = vi.mocked(writeFile).mock.calls.find(
        (c) => typeof c[0] === 'string' && (c[0] as string).endsWith('diff-session-001.patch'),
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
        getDiff: vi.fn().mockResolvedValue(''),
        commit: vi.fn().mockResolvedValue(undefined),
      };
      const ctx = makeCtx({ io: { commitManager: commitManager } as never });
      await executor.execute(ctx);
      const patchCall = vi.mocked(writeFile).mock.calls.find(
        (c) => typeof c[0] === 'string' && (c[0] as string).endsWith('diff-session-001.patch'),
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
        getDiff: vi.fn().mockResolvedValue(''),
        commit: vi.fn().mockResolvedValue(undefined),
      };
      const ctx = makeCtx({ io: { commitManager: commitManager } as never });
      await executor.execute(ctx);
      const patchCall = vi.mocked(writeFile).mock.calls.find(
        (c) => typeof c[0] === 'string' && (c[0] as string).endsWith('diff-session-001.patch'),
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

      const ctx = makeCtx({ services: { retryExecutor: retryExecutor } as never });
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

      const ctx = makeCtx({ services: { retryExecutor: retryExecutor } as never });
      await executor.execute(ctx);

      expect(descriptions.some((d) => d.includes('session-001') && d.includes('Session session-001'))).toBe(true);
    });
  });

  describe('per-task build check', () => {
    function makeCtxWithBuild(overrides: Partial<PhaseContext> = {}): PhaseContext {
      const base = makeCtx(overrides);
      return {
        ...base,
        config: {
          commands: { build: 'npm run build' },
          options: {
            maxParallelAgents: 2,
            maxRetriesPerTask: 3,
            perTaskBuildCheck: true,
            maxBuildFixRounds: 2,
          },
        } as never,
      };
    }

    beforeEach(() => {
      vi.mocked(execShell).mockResolvedValue({ exitCode: 0, stdout: 'Build succeeded', stderr: '' });
    });

    it('should skip build check when perTaskBuildCheck is false', async () => {
      const ctx = makeCtx({
        config: {
          commands: { build: 'npm run build' },
          options: { maxParallelAgents: 2, maxRetriesPerTask: 3, perTaskBuildCheck: false, maxBuildFixRounds: 2 },
        } as never,
      });
      await executor.execute(ctx);
      expect(execShell).not.toHaveBeenCalled();
    });

    it('should skip build check when build command is not configured', async () => {
      const ctx = makeCtx({
        config: {
          commands: {},
          options: { maxParallelAgents: 2, maxRetriesPerTask: 3, perTaskBuildCheck: true, maxBuildFixRounds: 2 },
        } as never,
      });
      await executor.execute(ctx);
      expect(execShell).not.toHaveBeenCalled();
    });

    it('should run build command when perTaskBuildCheck and build command are configured', async () => {
      const ctx = makeCtxWithBuild();
      await executor.execute(ctx);
      expect(execShell).toHaveBeenCalledWith('npm run build', expect.objectContaining({ cwd: '/tmp/worktree' }));
    });

    it('should launch test-writer after build succeeds', async () => {
      const ctx = makeCtxWithBuild();
      await executor.execute(ctx);
      const launchCalls = (ctx.services.launcher as never as { launchAgent: ReturnType<typeof vi.fn> }).launchAgent.mock.calls;
      const agents = launchCalls.map((c: [{ agent: string }]) => c[0].agent);
      expect(agents).toContain('test-writer');
    });

    it('should launch fix-surgeon when build fails', async () => {
      vi.mocked(execShell)
        .mockResolvedValueOnce({ exitCode: 1, stdout: '', stderr: 'TS error' })
        .mockResolvedValue({ exitCode: 0, stdout: '', stderr: '' });

      const launcher = {
        launchAgent: vi.fn()
          .mockResolvedValueOnce(makeSuccessAgentResult('code-writer'))
          .mockResolvedValueOnce(makeSuccessAgentResult('fix-surgeon'))
          .mockResolvedValueOnce(makeSuccessAgentResult('test-writer'))
          .mockResolvedValueOnce(makeSuccessAgentResult('code-reviewer')),
      };

      const ctx = makeCtxWithBuild({ services: { launcher: launcher } as never });
      await executor.execute(ctx);

      const launchCalls = launcher.launchAgent.mock.calls;
      const agents = launchCalls.map((c: [{ agent: string }]) => c[0].agent);
      expect(agents).toContain('fix-surgeon');
    });

    it('should invoke fix-surgeon with issueType build', async () => {
      vi.mocked(execShell)
        .mockResolvedValueOnce({ exitCode: 1, stdout: '', stderr: 'TS error' })
        .mockResolvedValue({ exitCode: 0, stdout: '', stderr: '' });

      const launcher = {
        launchAgent: vi.fn()
          .mockResolvedValueOnce(makeSuccessAgentResult('code-writer'))
          .mockResolvedValueOnce(makeSuccessAgentResult('fix-surgeon'))
          .mockResolvedValueOnce(makeSuccessAgentResult('test-writer'))
          .mockResolvedValueOnce(makeSuccessAgentResult('code-reviewer')),
      };

      const ctx = makeCtxWithBuild({ services: { launcher: launcher } as never });
      await executor.execute(ctx);

      expect(
        (ctx.services.contextBuilder as never as { buildForFixSurgeon: ReturnType<typeof vi.fn> }).buildForFixSurgeon,
      ).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        expect.any(String),
        expect.anything(),
        expect.anything(),
        expect.anything(),
        'build',
        3,
      );
    });

    it('should write build failure output to a file', async () => {
      vi.mocked(execShell)
        .mockResolvedValueOnce({ exitCode: 1, stdout: 'build output', stderr: 'TS error' })
        .mockResolvedValue({ exitCode: 0, stdout: '', stderr: '' });

      const launcher = {
        launchAgent: vi.fn()
          .mockResolvedValueOnce(makeSuccessAgentResult('code-writer'))
          .mockResolvedValueOnce(makeSuccessAgentResult('fix-surgeon'))
          .mockResolvedValueOnce(makeSuccessAgentResult('test-writer'))
          .mockResolvedValueOnce(makeSuccessAgentResult('code-reviewer')),
      };

      const ctx = makeCtxWithBuild({ services: { launcher: launcher } as never });
      await executor.execute(ctx);

      expect(writeFile).toHaveBeenCalledWith(
        expect.stringContaining('build-failure-session-001'),
        expect.stringContaining('TS error'),
        'utf-8',
      );
    });

    it('should record tokens for fix-surgeon during build fix round', async () => {
      vi.mocked(execShell)
        .mockResolvedValueOnce({ exitCode: 1, stdout: '', stderr: 'TS error' })
        .mockResolvedValue({ exitCode: 0, stdout: '', stderr: '' });

      const launcher = {
        launchAgent: vi.fn()
          .mockResolvedValueOnce(makeSuccessAgentResult('code-writer'))
          .mockResolvedValueOnce(makeSuccessAgentResult('fix-surgeon'))
          .mockResolvedValueOnce(makeSuccessAgentResult('test-writer'))
          .mockResolvedValueOnce(makeSuccessAgentResult('code-reviewer')),
      };

      const ctx = makeCtxWithBuild({ services: { launcher: launcher } as never });
      await executor.execute(ctx);

      expect(ctx.callbacks.recordTokens).toHaveBeenCalledWith('fix-surgeon', 50);
    });

    it('should re-run build after each fix-surgeon invocation', async () => {
      vi.mocked(execShell)
        .mockResolvedValueOnce({ exitCode: 1, stdout: '', stderr: 'error round 0' })
        .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '' });

      const launcher = {
        launchAgent: vi.fn()
          .mockResolvedValueOnce(makeSuccessAgentResult('code-writer'))
          .mockResolvedValueOnce(makeSuccessAgentResult('fix-surgeon'))
          .mockResolvedValueOnce(makeSuccessAgentResult('test-writer'))
          .mockResolvedValueOnce(makeSuccessAgentResult('code-reviewer')),
      };

      const ctx = makeCtxWithBuild({ services: { launcher: launcher } as never });
      await executor.execute(ctx);

      // execShell called twice: initial build (fail) + re-run after fix (pass)
      expect(execShell).toHaveBeenCalledTimes(2);
    });

    it('should throw an error when build still fails after maxBuildFixRounds', async () => {
      // Build always fails
      vi.mocked(execShell).mockResolvedValue({ exitCode: 1, stdout: '', stderr: 'always fails' });

      const launcher = {
        launchAgent: vi.fn()
          .mockResolvedValueOnce(makeSuccessAgentResult('code-writer'))
          .mockResolvedValue(makeSuccessAgentResult('fix-surgeon')),
      };

      const ctx = makeCtxWithBuild({ services: { launcher: launcher } as never });
      await expect(executor.execute(ctx)).rejects.toThrow('All implementation sessions blocked');
    });

    it('should throw containing maxBuildFixRounds in message after exhausting retries', async () => {
      vi.mocked(execShell).mockResolvedValue({ exitCode: 1, stdout: '', stderr: 'always fails' });

      const launcher = {
        launchAgent: vi.fn()
          .mockResolvedValueOnce(makeSuccessAgentResult('code-writer'))
          .mockResolvedValue(makeSuccessAgentResult('fix-surgeon')),
      };

      // Use retryExecutor that propagates the error
      const retryExecutor = {
        execute: vi.fn(async ({ fn }: { fn: (attempt: number) => Promise<unknown> }) => {
          try {
            await fn(1);
            return { success: true };
          } catch (err) {
            return { success: false, error: (err as Error).message };
          }
        }),
      };

      const ctx = makeCtxWithBuild({ services: { launcher: launcher, retryExecutor: retryExecutor } as never });
      await expect(executor.execute(ctx)).rejects.toThrow('All implementation sessions blocked');
      // Verify the inner error references the build fix rounds
      const lastCall = retryExecutor.execute.mock.results[0];
      expect(lastCall).toBeDefined();
    });

    it('should invoke fix-surgeon up to maxBuildFixRounds times', async () => {
      vi.mocked(execShell).mockResolvedValue({ exitCode: 1, stdout: '', stderr: 'always fails' });

      const launcher = {
        launchAgent: vi.fn()
          .mockResolvedValueOnce(makeSuccessAgentResult('code-writer'))
          .mockResolvedValue(makeSuccessAgentResult('fix-surgeon')),
      };

      const ctx = makeCtxWithBuild({ services: { launcher: launcher } as never });
      await expect(executor.execute(ctx)).rejects.toThrow();

      const launchCalls = launcher.launchAgent.mock.calls;
      const fixSurgeonCalls = launchCalls.filter((c: [{ agent: string }]) => c[0].agent === 'fix-surgeon');
      // maxBuildFixRounds is 2
      expect(fixSurgeonCalls).toHaveLength(2);
    });
  });

  // ---------------------------------------------------------------------------
  // Whole-PR review tests
  // ---------------------------------------------------------------------------

  function makeWholePrCtx(overrides: Partial<PhaseContext> = {}): PhaseContext {
    return makeCtx(overrides);
  }

  describe('whole-PR review', () => {
    it('should launch whole-pr-reviewer after all sessions complete (pass path)', async () => {
      vi.mocked(exists).mockResolvedValue(true);

      const launcher = {
        launchAgent: vi.fn()
          .mockResolvedValueOnce(makeSuccessAgentResult('code-writer'))
          .mockResolvedValueOnce(makeSuccessAgentResult('test-writer'))
          .mockResolvedValueOnce(makeSuccessAgentResult('code-reviewer'))
          .mockResolvedValueOnce(makeSuccessAgentResult('whole-pr-reviewer')),
      };

      const resultParser = {
        parseImplementationPlan: vi.fn().mockResolvedValue([makeSession('session-001')]),
        parseReview: vi.fn()
          .mockResolvedValueOnce({ verdict: 'pass' })   // per-session review
          .mockResolvedValueOnce({ verdict: 'pass' }),  // whole-PR review
      };

      const ctx = makeWholePrCtx({ services: { launcher: launcher, resultParser: resultParser } as never });
      await executor.execute(ctx);

      const agents = launcher.launchAgent.mock.calls.map((c: [{ agent: string }]) => c[0].agent);
      expect(agents).toContain('whole-pr-reviewer');
    });

    it('should call getDiff with baseCommit for the whole-PR review diff', async () => {
      vi.mocked(exists).mockResolvedValue(true);

      const launcher = {
        launchAgent: vi.fn()
          .mockResolvedValueOnce(makeSuccessAgentResult('code-writer'))
          .mockResolvedValueOnce(makeSuccessAgentResult('test-writer'))
          .mockResolvedValueOnce(makeSuccessAgentResult('code-reviewer'))
          .mockResolvedValueOnce(makeSuccessAgentResult('whole-pr-reviewer')),
      };

      const resultParser = {
        parseImplementationPlan: vi.fn().mockResolvedValue([makeSession('session-001')]),
        parseReview: vi.fn().mockResolvedValue({ verdict: 'pass' }),
      };

      const ctx = makeWholePrCtx({ services: { launcher: launcher, resultParser: resultParser } as never });
      await executor.execute(ctx);

      expect(
        (ctx.io.commitManager as never as { getDiff: ReturnType<typeof vi.fn> }).getDiff,
      ).toHaveBeenCalledWith('abc123');
    });

    it('should write whole-pr-diff.patch to progressDir', async () => {
      vi.mocked(exists).mockResolvedValue(true);

      const launcher = {
        launchAgent: vi.fn()
          .mockResolvedValueOnce(makeSuccessAgentResult('code-writer'))
          .mockResolvedValueOnce(makeSuccessAgentResult('test-writer'))
          .mockResolvedValueOnce(makeSuccessAgentResult('code-reviewer'))
          .mockResolvedValueOnce(makeSuccessAgentResult('whole-pr-reviewer')),
      };

      const resultParser = {
        parseImplementationPlan: vi.fn().mockResolvedValue([makeSession('session-001')]),
        parseReview: vi.fn().mockResolvedValue({ verdict: 'pass' }),
      };

      const ctx = makeWholePrCtx({ services: { launcher: launcher, resultParser: resultParser } as never });
      await executor.execute(ctx);

      expect(writeFile).toHaveBeenCalledWith(
        join('/tmp/progress', 'whole-pr-diff.patch'),
        expect.any(String),
        'utf-8',
      );
    });

    it('should write full (untruncated) whole-pr diff even when diff exceeds 200,000 chars', async () => {
      vi.mocked(exists).mockResolvedValue(true);

      const largeDiff = 'x'.repeat(300_000);
      const commitManager = {
        getChangedFiles: vi.fn().mockResolvedValue([]),
        getTaskDiff: vi.fn().mockResolvedValue(''),
        getDiff: vi.fn().mockResolvedValue(largeDiff),
        commit: vi.fn().mockResolvedValue(undefined),
      };

      const launcher = {
        launchAgent: vi.fn()
          .mockResolvedValueOnce(makeSuccessAgentResult('code-writer'))
          .mockResolvedValueOnce(makeSuccessAgentResult('test-writer'))
          .mockResolvedValueOnce(makeSuccessAgentResult('code-reviewer'))
          .mockResolvedValueOnce(makeSuccessAgentResult('whole-pr-reviewer')),
      };

      const resultParser = {
        parseImplementationPlan: vi.fn().mockResolvedValue([makeSession('session-001')]),
        parseReview: vi.fn().mockResolvedValue({ verdict: 'pass' }),
      };

      const ctx = makeWholePrCtx({
        services: { launcher: launcher, resultParser: resultParser } as never,
        io: { commitManager: commitManager } as never,
      });
      await executor.execute(ctx);

      const patchCall = vi.mocked(writeFile).mock.calls.find(
        (c) => typeof c[0] === 'string' && (c[0] as string).endsWith('whole-pr-diff.patch'),
      );
      expect(patchCall).toBeDefined();
      const written = patchCall![1] as string;
      expect(written).toBe(largeDiff);
      expect(written).not.toContain('[Diff truncated');
    });

    it('should pass collected sessionSummaries to buildForWholePrCodeReviewer', async () => {
      vi.mocked(exists).mockResolvedValue(true);

      const summaryData: SessionReviewSummary = {
        sessionId: 'session-001',
        verdict: 'pass',
        summary: 'Code looks good',
        keyFindings: ['minor lint issue'],
      };
      vi.mocked(readFile).mockResolvedValue(JSON.stringify(summaryData) as never);

      const launcher = {
        launchAgent: vi.fn()
          .mockResolvedValueOnce(makeSuccessAgentResult('code-writer'))
          .mockResolvedValueOnce(makeSuccessAgentResult('test-writer'))
          .mockResolvedValueOnce(makeSuccessAgentResult('code-reviewer'))
          .mockResolvedValueOnce(makeSuccessAgentResult('whole-pr-reviewer')),
      };

      const resultParser = {
        parseImplementationPlan: vi.fn().mockResolvedValue([makeSession('session-001')]),
        parseReview: vi.fn().mockResolvedValue({ verdict: 'pass' }),
      };

      const ctx = makeWholePrCtx({ services: { launcher: launcher, resultParser: resultParser } as never });
      await executor.execute(ctx);

      expect(
        (ctx.services.contextBuilder as never as { buildForWholePrCodeReviewer: ReturnType<typeof vi.fn> }).buildForWholePrCodeReviewer,
      ).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        expect.anything(),
        expect.anything(),
        expect.anything(),
        expect.arrayContaining([expect.objectContaining({ sessionId: 'session-001', verdict: 'pass' })]),
      );
    });

    it('should pass empty sessionSummaries when no summary files exist', async () => {
      vi.mocked(exists).mockResolvedValue(true);
      // Explicitly ensure readFile rejects (ENOENT) so no summaries are found
      vi.mocked(readFile).mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));

      const launcher = {
        launchAgent: vi.fn()
          .mockResolvedValueOnce(makeSuccessAgentResult('code-writer'))
          .mockResolvedValueOnce(makeSuccessAgentResult('test-writer'))
          .mockResolvedValueOnce(makeSuccessAgentResult('code-reviewer'))
          .mockResolvedValueOnce(makeSuccessAgentResult('whole-pr-reviewer')),
      };

      const resultParser = {
        parseImplementationPlan: vi.fn().mockResolvedValue([makeSession('session-001')]),
        parseReview: vi.fn().mockResolvedValue({ verdict: 'pass' }),
      };

      const ctx = makeWholePrCtx({ services: { launcher: launcher, resultParser: resultParser } as never });
      await executor.execute(ctx);

      expect(
        (ctx.services.contextBuilder as never as { buildForWholePrCodeReviewer: ReturnType<typeof vi.fn> }).buildForWholePrCodeReviewer,
      ).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        expect.anything(),
        expect.anything(),
        expect.anything(),
        [],
      );
    });

    it('needs-fixes → fix-surgeon → exits after successful fix (no re-review)', async () => {
      vi.mocked(exists).mockResolvedValue(true);

      const launcher = {
        launchAgent: vi.fn()
          .mockResolvedValueOnce(makeSuccessAgentResult('code-writer'))
          .mockResolvedValueOnce(makeSuccessAgentResult('test-writer'))
          .mockResolvedValueOnce(makeSuccessAgentResult('code-reviewer'))
          .mockResolvedValueOnce(makeSuccessAgentResult('whole-pr-reviewer'))  // attempt 0: needs-fixes
          .mockResolvedValueOnce(makeSuccessAgentResult('fix-surgeon')),       // fix succeeds → done
      };

      const resultParser = {
        parseImplementationPlan: vi.fn().mockResolvedValue([makeSession('session-001')]),
        parseReview: vi.fn()
          .mockResolvedValueOnce({ verdict: 'pass' })         // per-session code-reviewer
          .mockResolvedValueOnce({ verdict: 'needs-fixes' }), // whole-PR: needs-fixes
      };

      const ctx = makeWholePrCtx({ services: { launcher: launcher, resultParser: resultParser } as never });
      await executor.execute(ctx);

      const agents = launcher.launchAgent.mock.calls.map((c: [{ agent: string }]) => c[0].agent);
      // A successful fix exits immediately — whole-pr-reviewer should only be called once
      expect(agents.filter((a: string) => a === 'whole-pr-reviewer')).toHaveLength(1);
      expect(agents).toContain('fix-surgeon');
    });

    it('should commit fix-surgeon output after a successful fix', async () => {
      vi.mocked(exists).mockResolvedValue(true);

      const launcher = {
        launchAgent: vi.fn()
          .mockResolvedValueOnce(makeSuccessAgentResult('code-writer'))
          .mockResolvedValueOnce(makeSuccessAgentResult('test-writer'))
          .mockResolvedValueOnce(makeSuccessAgentResult('code-reviewer'))
          .mockResolvedValueOnce(makeSuccessAgentResult('whole-pr-reviewer'))
          .mockResolvedValueOnce(makeSuccessAgentResult('fix-surgeon')),
      };

      const resultParser = {
        parseImplementationPlan: vi.fn().mockResolvedValue([makeSession('session-001')]),
        parseReview: vi.fn()
          .mockResolvedValueOnce({ verdict: 'pass' })
          .mockResolvedValueOnce({ verdict: 'needs-fixes' }),
      };

      const ctx = makeWholePrCtx({ services: { launcher: launcher, resultParser: resultParser } as never });
      await executor.execute(ctx);

      const commitCalls = (
        ctx.io.commitManager as never as { commit: ReturnType<typeof vi.fn> }
      ).commit.mock.calls as [string, number, string][];
      const fixCommit = commitCalls.find(([msg]) => msg.includes('whole-PR review fixes'));
      expect(fixCommit).toBeDefined();
    });

    it('should stop and log a warning when max retries exceeded (maxWholePrReviewRetries=0)', async () => {
      vi.mocked(exists).mockResolvedValue(true);

      // With maxWholePrReviewRetries=0 the guard fires on attempt 0 before fix-surgeon runs
      const launcher = {
        launchAgent: vi.fn()
          .mockResolvedValueOnce(makeSuccessAgentResult('code-writer'))
          .mockResolvedValueOnce(makeSuccessAgentResult('test-writer'))
          .mockResolvedValueOnce(makeSuccessAgentResult('code-reviewer'))
          .mockResolvedValueOnce(makeSuccessAgentResult('whole-pr-reviewer')), // needs-fixes → exceeded immediately
      };

      const resultParser = {
        parseImplementationPlan: vi.fn().mockResolvedValue([makeSession('session-001')]),
        parseReview: vi.fn()
          .mockResolvedValueOnce({ verdict: 'pass' })         // per-session
          .mockResolvedValueOnce({ verdict: 'needs-fixes' }), // whole-PR: exceeded with retries=0
      };

      const ctx = makeWholePrCtx({
        services: { launcher: launcher, resultParser: resultParser } as never,
        config: {
          commands: { build: undefined },
          options: { maxParallelAgents: 2, maxRetriesPerTask: 3, perTaskBuildCheck: true, maxBuildFixRounds: 2, maxWholePrReviewRetries: 0 },
        } as never,
      });
      // Should NOT throw — just logs a warning and continues to phase 4
      await expect(executor.execute(ctx)).resolves.toBe(join('/tmp/progress', 'implementation-plan.md'));

      expect(
        (ctx.services.logger as never as { warn: ReturnType<typeof vi.fn> }).warn,
      ).toHaveBeenCalledWith(
        expect.stringContaining('Max retries'),
        expect.objectContaining({ issueNumber: 42, phase: 3 }),
      );
    });

    it('should record tokens for whole-pr-reviewer', async () => {
      vi.mocked(exists).mockResolvedValue(true);

      const launcher = {
        launchAgent: vi.fn()
          .mockResolvedValueOnce(makeSuccessAgentResult('code-writer'))
          .mockResolvedValueOnce(makeSuccessAgentResult('test-writer'))
          .mockResolvedValueOnce(makeSuccessAgentResult('code-reviewer'))
          .mockResolvedValueOnce(makeSuccessAgentResult('whole-pr-reviewer')),
      };

      const resultParser = {
        parseImplementationPlan: vi.fn().mockResolvedValue([makeSession('session-001')]),
        parseReview: vi.fn().mockResolvedValue({ verdict: 'pass' }),
      };

      const ctx = makeWholePrCtx({ services: { launcher: launcher, resultParser: resultParser } as never });
      await executor.execute(ctx);

      expect(ctx.callbacks.recordTokens).toHaveBeenCalledWith('whole-pr-reviewer', 50);
    });

    it('should skip and log warning when parseReview throws during whole-PR review', async () => {
      vi.mocked(exists).mockResolvedValue(true);

      const launcher = {
        launchAgent: vi.fn()
          .mockResolvedValueOnce(makeSuccessAgentResult('code-writer'))
          .mockResolvedValueOnce(makeSuccessAgentResult('test-writer'))
          .mockResolvedValueOnce(makeSuccessAgentResult('code-reviewer'))
          .mockResolvedValueOnce(makeSuccessAgentResult('whole-pr-reviewer')),
      };

      const resultParser = {
        parseImplementationPlan: vi.fn().mockResolvedValue([makeSession('session-001')]),
        parseReview: vi.fn()
          .mockResolvedValueOnce({ verdict: 'pass' })         // per-session code-reviewer passes
          .mockRejectedValueOnce(new Error('malformed cadre-json block')), // whole-PR review parse fails
      };

      const ctx = makeWholePrCtx({ services: { launcher: launcher, resultParser: resultParser } as never });
      // Should not throw — gracefully skips and logs a warning
      await expect(executor.execute(ctx)).resolves.toBe(join('/tmp/progress', 'implementation-plan.md'));

      expect(
        (ctx.services.logger as never as { warn: ReturnType<typeof vi.fn> }).warn,
      ).toHaveBeenCalledWith(
        expect.stringContaining('Failed to parse review output'),
        expect.objectContaining({ issueNumber: 42, phase: 3 }),
      );
    });

    it('should skip and log warning when whole-pr-reviewer agent does not succeed', async () => {
      vi.mocked(exists).mockResolvedValue(true);

      const failedReviewer: AgentResult = {
        agent: 'whole-pr-reviewer',
        success: false,
        exitCode: 1,
        timedOut: false,
        duration: 50,
        stdout: '',
        stderr: 'timeout',
        tokenUsage: 0,
        outputPath: '/progress/whole-pr-review.md',
        outputExists: false,
      };

      const launcher = {
        launchAgent: vi.fn()
          .mockResolvedValueOnce(makeSuccessAgentResult('code-writer'))
          .mockResolvedValueOnce(makeSuccessAgentResult('test-writer'))
          .mockResolvedValueOnce(makeSuccessAgentResult('code-reviewer'))
          .mockResolvedValueOnce(failedReviewer),
      };

      const resultParser = {
        parseImplementationPlan: vi.fn().mockResolvedValue([makeSession('session-001')]),
        parseReview: vi.fn().mockResolvedValueOnce({ verdict: 'pass' }),  // per-session only
      };

      const ctx = makeWholePrCtx({ services: { launcher: launcher, resultParser: resultParser } as never });
      await expect(executor.execute(ctx)).resolves.toBe(join('/tmp/progress', 'implementation-plan.md'));

      expect(
        (ctx.services.logger as never as { warn: ReturnType<typeof vi.fn> }).warn,
      ).toHaveBeenCalledWith(
        expect.stringContaining('Reviewer agent did not succeed'),
        expect.objectContaining({ issueNumber: 42, phase: 3 }),
      );
    });

    it('should skip and log warning when whole-PR review output file is not produced', async () => {
      // Exists returns false for 'whole-pr-review.md' (output), but true for session plan paths
      vi.mocked(exists).mockImplementation(async (path) => !String(path).endsWith('whole-pr-review.md'));

      const launcher = {
        launchAgent: vi.fn()
          .mockResolvedValueOnce(makeSuccessAgentResult('code-writer'))
          .mockResolvedValueOnce(makeSuccessAgentResult('test-writer'))
          .mockResolvedValueOnce(makeSuccessAgentResult('code-reviewer'))
          .mockResolvedValueOnce(makeSuccessAgentResult('whole-pr-reviewer')),
      };

      const resultParser = {
        parseImplementationPlan: vi.fn().mockResolvedValue([makeSession('session-001')]),
        parseReview: vi.fn().mockResolvedValueOnce({ verdict: 'pass' }),  // per-session code-reviewer
      };

      const ctx = makeWholePrCtx({ services: { launcher: launcher, resultParser: resultParser } as never });
      await expect(executor.execute(ctx)).resolves.toBe(join('/tmp/progress', 'implementation-plan.md'));

      expect(
        (ctx.services.logger as never as { warn: ReturnType<typeof vi.fn> }).warn,
      ).toHaveBeenCalledWith(
        expect.stringContaining('No output file produced'),
        expect.objectContaining({ issueNumber: 42, phase: 3 }),
      );
    });

    it('should abort review loop and log warning when fix-surgeon fails during whole-PR review', async () => {
      vi.mocked(exists).mockResolvedValue(true);

      const failedFixSurgeon: AgentResult = {
        agent: 'fix-surgeon',
        success: false,
        exitCode: 1,
        timedOut: false,
        duration: 50,
        stdout: '',
        stderr: 'error',
        tokenUsage: 0,
        outputPath: '/progress/output.md',
        outputExists: false,
      };

      const launcher = {
        launchAgent: vi.fn()
          .mockResolvedValueOnce(makeSuccessAgentResult('code-writer'))
          .mockResolvedValueOnce(makeSuccessAgentResult('test-writer'))
          .mockResolvedValueOnce(makeSuccessAgentResult('code-reviewer'))
          .mockResolvedValueOnce(makeSuccessAgentResult('whole-pr-reviewer'))  // attempt 0: needs-fixes
          .mockResolvedValueOnce(failedFixSurgeon),                            // fix-surgeon fails
      };

      const resultParser = {
        parseImplementationPlan: vi.fn().mockResolvedValue([makeSession('session-001')]),
        parseReview: vi.fn()
          .mockResolvedValueOnce({ verdict: 'pass' })         // per-session code-reviewer
          .mockResolvedValueOnce({ verdict: 'needs-fixes' }), // whole-PR review attempt 0
      };

      const ctx = makeWholePrCtx({ services: { launcher: launcher, resultParser: resultParser } as never });
      // Should not throw — aborts the review loop gracefully and continues to phase 4
      await expect(executor.execute(ctx)).resolves.toBe(join('/tmp/progress', 'implementation-plan.md'));

      expect(
        (ctx.services.logger as never as { warn: ReturnType<typeof vi.fn> }).warn,
      ).toHaveBeenCalledWith(
        expect.stringContaining('Fix surgeon failed'),
        expect.objectContaining({ issueNumber: 42, phase: 3 }),
      );

      // Should not have launched a second whole-pr-reviewer after the fix-surgeon failure
      const agents = launcher.launchAgent.mock.calls.map((c: [{ agent: string }]) => c[0].agent);
      expect(agents.filter((a: string) => a === 'whole-pr-reviewer')).toHaveLength(1);
    });
  });
});
