import { describe, it, expect, vi, beforeEach } from 'vitest';
import { join } from 'node:path';
import { PRCompositionPhaseExecutor } from '../src/executors/pr-composition-phase-executor.js';
import type { PhaseContext } from '../src/core/phase-executor.js';
import type { AgentResult } from '../src/agents/types.js';

vi.mock('node:fs/promises', () => ({
  writeFile: vi.fn().mockResolvedValue(undefined),
}));

import { writeFile } from 'node:fs/promises';

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
    launchAgent: vi.fn().mockResolvedValue(makeSuccessAgentResult('pr-composer')),
  };

  const retryExecutor = {
    execute: vi.fn(async ({ fn }: { fn: () => Promise<AgentResult> }) => {
      try {
        const result = await fn();
        return { success: true, result };
      } catch (err) {
        return { success: false, error: (err as Error).message };
      }
    }),
  };

  const contextBuilder = {
    buildForPRComposer: vi.fn().mockResolvedValue('/progress/composer-ctx.json'),
  };

  const resultParser = {
    parsePRContent: vi.fn().mockResolvedValue({
      title: 'Fix: resolve issue',
      body: 'This PR resolves the issue.',
    }),
  };

  const commitManager = {
    getDiff: vi.fn().mockResolvedValue('diff content'),
    squash: vi.fn().mockResolvedValue(undefined),
    push: vi.fn().mockResolvedValue(undefined),
  };

  const platform = {
    issueLinkSuffix: vi.fn().mockReturnValue('Closes #42'),
    createPullRequest: vi.fn().mockResolvedValue(undefined),
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
      options: { maxRetriesPerTask: 3 },
      pullRequest: { autoCreate: false, linkIssue: false, draft: false },
      commits: { squashBeforePR: false },
      baseBranch: 'main',
    } as never,
    progressDir: '/tmp/progress',
    contextBuilder: contextBuilder as never,
    launcher: launcher as never,
    resultParser: resultParser as never,
    checkpoint: {} as never,
    commitManager: commitManager as never,
    retryExecutor: retryExecutor as never,
    tokenTracker: {} as never,
    progressWriter: {} as never,
    platform: platform as never,
    recordTokens,
    checkBudget,
    logger: logger as never,
    ...overrides,
  };
}

describe('PRCompositionPhaseExecutor', () => {
  let executor: PRCompositionPhaseExecutor;

  beforeEach(() => {
    vi.clearAllMocks();
    executor = new PRCompositionPhaseExecutor();
  });

  describe('PhaseExecutor contract', () => {
    it('should have phaseId of 5', () => {
      expect(executor.phaseId).toBe(5);
    });

    it('should have name "PR Composition"', () => {
      expect(executor.name).toBe('PR Composition');
    });

    it('should implement the PhaseExecutor interface', () => {
      expect(typeof executor.execute).toBe('function');
    });
  });

  describe('execute() happy path', () => {
    it('should get diff using baseCommit from worktree', async () => {
      const ctx = makeCtx();
      await executor.execute(ctx);
      expect(
        (ctx.commitManager as never as { getDiff: ReturnType<typeof vi.fn> }).getDiff,
      ).toHaveBeenCalledWith('abc123');
    });

    it('should write diff to progressDir/full-diff.patch', async () => {
      const ctx = makeCtx();
      await executor.execute(ctx);
      expect(writeFile).toHaveBeenCalledWith(
        join('/tmp/progress', 'full-diff.patch'),
        'diff content',
        'utf-8',
      );
    });

    it('should build context for pr-composer with correct args', async () => {
      const ctx = makeCtx();
      await executor.execute(ctx);
      expect(
        (ctx.contextBuilder as never as { buildForPRComposer: ReturnType<typeof vi.fn> }).buildForPRComposer,
      ).toHaveBeenCalledWith(
        42,
        '/tmp/worktree',
        ctx.issue,
        join('/tmp/progress', 'analysis.md'),
        join('/tmp/progress', 'implementation-plan.md'),
        join('/tmp/progress', 'integration-report.md'),
        join('/tmp/progress', 'full-diff.patch'),
        '/tmp/progress',
      );
    });

    it('should launch pr-composer with correct invocation', async () => {
      const ctx = makeCtx();
      await executor.execute(ctx);
      expect(
        (ctx.launcher as never as { launchAgent: ReturnType<typeof vi.fn> }).launchAgent,
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          agent: 'pr-composer',
          issueNumber: 42,
          phase: 5,
          contextPath: '/progress/composer-ctx.json',
          outputPath: join('/tmp/progress', 'pr-content.md'),
        }),
        '/tmp/worktree',
      );
    });

    it('should return path to pr-content.md', async () => {
      const ctx = makeCtx();
      const result = await executor.execute(ctx);
      expect(result).toBe(join('/tmp/progress', 'pr-content.md'));
    });

    it('should record tokens for pr-composer', async () => {
      const ctx = makeCtx();
      await executor.execute(ctx);
      expect(ctx.recordTokens).toHaveBeenCalledWith('pr-composer', 50);
    });

    it('should check budget during execution', async () => {
      const ctx = makeCtx();
      await executor.execute(ctx);
      expect(ctx.checkBudget).toHaveBeenCalled();
    });

    it('should not create PR when autoCreate is false', async () => {
      const ctx = makeCtx();
      await executor.execute(ctx);
      expect(
        (ctx.platform as never as { createPullRequest: ReturnType<typeof vi.fn> }).createPullRequest,
      ).not.toHaveBeenCalled();
    });

    it('should not push when autoCreate is false', async () => {
      const ctx = makeCtx();
      await executor.execute(ctx);
      expect(
        (ctx.commitManager as never as { push: ReturnType<typeof vi.fn> }).push,
      ).not.toHaveBeenCalled();
    });
  });

  describe('execute() with autoCreate enabled', () => {
    function makeAutoCreateCtx(overrides: Partial<PhaseContext> = {}): PhaseContext {
      return makeCtx({
        config: {
          options: { maxRetriesPerTask: 3 },
          pullRequest: { autoCreate: true, linkIssue: false, draft: false },
          commits: { squashBeforePR: false },
          baseBranch: 'main',
        } as never,
        ...overrides,
      });
    }

    it('should parse PR content from pr-content.md', async () => {
      const ctx = makeAutoCreateCtx();
      await executor.execute(ctx);
      expect(
        (ctx.resultParser as never as { parsePRContent: ReturnType<typeof vi.fn> }).parsePRContent,
      ).toHaveBeenCalledWith(join('/tmp/progress', 'pr-content.md'));
    });

    it('should push before creating PR', async () => {
      const ctx = makeAutoCreateCtx();
      await executor.execute(ctx);
      expect(
        (ctx.commitManager as never as { push: ReturnType<typeof vi.fn> }).push,
      ).toHaveBeenCalledWith(true);
    });

    it('should create PR with title including issue number', async () => {
      const ctx = makeAutoCreateCtx();
      await executor.execute(ctx);
      expect(
        (ctx.platform as never as { createPullRequest: ReturnType<typeof vi.fn> }).createPullRequest,
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Fix: resolve issue (#42)',
          head: 'cadre/issue-42',
          base: 'main',
          draft: false,
        }),
      );
    });

    it('should use issue title as fallback when PR title is empty', async () => {
      const resultParser = {
        parsePRContent: vi.fn().mockResolvedValue({ title: '', body: 'Body text.' }),
      };
      const ctx = makeAutoCreateCtx({ resultParser: resultParser as never });
      await executor.execute(ctx);
      expect(
        (ctx.platform as never as { createPullRequest: ReturnType<typeof vi.fn> }).createPullRequest,
      ).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Test issue (#42)' }),
      );
    });

    it('should not squash when squashBeforePR is false', async () => {
      const ctx = makeAutoCreateCtx();
      await executor.execute(ctx);
      expect(
        (ctx.commitManager as never as { squash: ReturnType<typeof vi.fn> }).squash,
      ).not.toHaveBeenCalled();
    });

    it('should squash when squashBeforePR is true', async () => {
      const ctx = makeAutoCreateCtx({
        config: {
          options: { maxRetriesPerTask: 3 },
          pullRequest: { autoCreate: true, linkIssue: false, draft: false },
          commits: { squashBeforePR: true },
          baseBranch: 'main',
        } as never,
      });
      await executor.execute(ctx);
      expect(
        (ctx.commitManager as never as { squash: ReturnType<typeof vi.fn> }).squash,
      ).toHaveBeenCalledWith('abc123', 'Fix: resolve issue');
    });

    it('should use issue title as squash message fallback when PR title is empty', async () => {
      const resultParser = {
        parsePRContent: vi.fn().mockResolvedValue({ title: '', body: 'Body.' }),
      };
      const ctx = makeAutoCreateCtx({
        config: {
          options: { maxRetriesPerTask: 3 },
          pullRequest: { autoCreate: true, linkIssue: false, draft: false },
          commits: { squashBeforePR: true },
          baseBranch: 'main',
        } as never,
        resultParser: resultParser as never,
      });
      await executor.execute(ctx);
      expect(
        (ctx.commitManager as never as { squash: ReturnType<typeof vi.fn> }).squash,
      ).toHaveBeenCalledWith('abc123', 'Fix #42: Test issue');
    });

    it('should append issue link suffix when linkIssue is true', async () => {
      const ctx = makeAutoCreateCtx({
        config: {
          options: { maxRetriesPerTask: 3 },
          pullRequest: { autoCreate: true, linkIssue: true, draft: false },
          commits: { squashBeforePR: false },
          baseBranch: 'main',
        } as never,
      });
      await executor.execute(ctx);
      expect(
        (ctx.platform as never as { issueLinkSuffix: ReturnType<typeof vi.fn> }).issueLinkSuffix,
      ).toHaveBeenCalledWith(42);
      expect(
        (ctx.platform as never as { createPullRequest: ReturnType<typeof vi.fn> }).createPullRequest,
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          body: expect.stringContaining('Closes #42'),
        }),
      );
    });

    it('should not append issue link suffix when linkIssue is false', async () => {
      const ctx = makeAutoCreateCtx();
      await executor.execute(ctx);
      expect(
        (ctx.platform as never as { issueLinkSuffix: ReturnType<typeof vi.fn> }).issueLinkSuffix,
      ).not.toHaveBeenCalled();
    });

    it('should not throw when createPullRequest fails (non-critical)', async () => {
      const platform = {
        issueLinkSuffix: vi.fn().mockReturnValue('Closes #42'),
        createPullRequest: vi.fn().mockRejectedValue(new Error('API rate limit')),
      };
      const ctx = makeAutoCreateCtx({ platform: platform as never });
      await expect(executor.execute(ctx)).resolves.toBe(join('/tmp/progress', 'pr-content.md'));
    });

    it('should log error when createPullRequest fails', async () => {
      const platform = {
        issueLinkSuffix: vi.fn().mockReturnValue('Closes #42'),
        createPullRequest: vi.fn().mockRejectedValue(new Error('API rate limit')),
      };
      const logger = {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
      };
      const ctx = makeAutoCreateCtx({ platform: platform as never, logger: logger as never });
      await executor.execute(ctx);
      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining('Failed to create PR'),
        expect.objectContaining({ issueNumber: 42 }),
      );
    });
  });

  describe('execute() error handling', () => {
    it('should throw if pr-composer agent fails', async () => {
      const failResult: AgentResult = {
        agent: 'pr-composer',
        success: false,
        exitCode: 1,
        timedOut: false,
        duration: 100,
        stdout: '',
        stderr: 'composer error',
        tokenUsage: null,
        outputPath: '',
        outputExists: false,
        error: 'composer error',
      };
      const launcher = { launchAgent: vi.fn().mockResolvedValue(failResult) };
      const ctx = makeCtx({ launcher: launcher as never });
      await expect(executor.execute(ctx)).rejects.toThrow('PR composer failed:');
    });

    it('should throw if retryExecutor fails completely', async () => {
      const retryExecutor = {
        execute: vi.fn().mockResolvedValue({ success: false, error: 'max retries exceeded' }),
      };
      const ctx = makeCtx({ retryExecutor: retryExecutor as never });
      await expect(executor.execute(ctx)).rejects.toThrow('PR composer failed:');
    });
  });

  describe('launchWithRetry uses correct retry configuration', () => {
    it('should pass maxRetriesPerTask from config to retryExecutor', async () => {
      const retryExecutor = {
        execute: vi.fn(async ({ fn }: { fn: () => Promise<AgentResult> }) => {
          const result = await fn();
          return { success: true, result };
        }),
      };
      const ctx = makeCtx({ retryExecutor: retryExecutor as never });
      await executor.execute(ctx);
      expect(retryExecutor.execute).toHaveBeenCalledWith(
        expect.objectContaining({ maxAttempts: 3 }),
      );
    });

    it('should use agent name as description for retryExecutor', async () => {
      const descriptions: string[] = [];
      const retryExecutor = {
        execute: vi.fn(async ({ fn, description }: { fn: () => Promise<AgentResult>; description: string }) => {
          descriptions.push(description);
          const result = await fn();
          return { success: true, result };
        }),
      };
      const ctx = makeCtx({ retryExecutor: retryExecutor as never });
      await executor.execute(ctx);
      expect(descriptions).toContain('pr-composer');
    });
  });
});
