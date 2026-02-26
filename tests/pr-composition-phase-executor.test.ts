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
    stripCadreFiles: vi.fn().mockResolvedValue(undefined),
    push: vi.fn().mockResolvedValue(undefined),
  };

  const platform = {
    issueLinkSuffix: vi.fn().mockReturnValue('Closes #42'),
    createPullRequest: vi.fn().mockResolvedValue(undefined),
    updatePullRequest: vi.fn().mockResolvedValue(undefined),
    findOpenPR: vi.fn().mockResolvedValue(null),
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
    tokenTracker: {} as never,
    contextBuilder: contextBuilder as never,
    resultParser: resultParser as never,
    logger: logger as never,
  };

  const io = {
    progressDir: '/tmp/progress',
    progressWriter: {} as never,
    checkpoint: {} as never,
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
      options: { maxRetriesPerTask: 3 },
      pullRequest: { autoCreate: false, linkIssue: false, draft: false },
      commits: { squashBeforePR: false },
      baseBranch: 'main',
    } as never,
    platform: platform as never,
    services: { ...services, ...overrides.services } as never,
    io: { ...io, ...overrides.io } as never,
    callbacks: { ...callbacks, ...overrides.callbacks } as never,
    ...Object.fromEntries(
      Object.entries(overrides).filter(([k]) => !['services', 'io', 'callbacks'].includes(k)),
    ),
  } as PhaseContext;
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
        (ctx.io.commitManager as never as { getDiff: ReturnType<typeof vi.fn> }).getDiff,
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
        (ctx.services.contextBuilder as never as { buildForPRComposer: ReturnType<typeof vi.fn> }).buildForPRComposer,
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
        (ctx.services.launcher as never as { launchAgent: ReturnType<typeof vi.fn> }).launchAgent,
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
      expect(ctx.callbacks.recordTokens).toHaveBeenCalledWith('pr-composer', 50);
    });

    it('should check budget during execution', async () => {
      const ctx = makeCtx();
      await executor.execute(ctx);
      expect(ctx.callbacks.checkBudget).toHaveBeenCalled();
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
        (ctx.io.commitManager as never as { push: ReturnType<typeof vi.fn> }).push,
      ).not.toHaveBeenCalled();
    });

    it('should not call ctx.callbacks.setPR when autoCreate is false', async () => {
      const setPR = vi.fn();
      const ctx = makeCtx({ callbacks: { setPR } as never });
      await executor.execute(ctx);
      expect(setPR).not.toHaveBeenCalled();
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
        (ctx.services.resultParser as never as { parsePRContent: ReturnType<typeof vi.fn> }).parsePRContent,
      ).toHaveBeenCalledWith(join('/tmp/progress', 'pr-content.md'));
    });

    it('should push before creating PR', async () => {
      const ctx = makeAutoCreateCtx();
      await executor.execute(ctx);
      expect(
        (ctx.io.commitManager as never as { push: ReturnType<typeof vi.fn> }).push,
      ).toHaveBeenCalledWith(true, 'cadre/issue-42');
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
      const ctx = makeAutoCreateCtx({ services: { resultParser: resultParser } as never });
      await executor.execute(ctx);
      expect(
        (ctx.platform as never as { createPullRequest: ReturnType<typeof vi.fn> }).createPullRequest,
      ).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Test issue (#42)' }),
      );
    });

    it('should always call stripCadreFiles regardless of squashBeforePR', async () => {
      const ctx = makeAutoCreateCtx();
      await executor.execute(ctx);
      expect(
        (ctx.io.commitManager as never as { stripCadreFiles: ReturnType<typeof vi.fn> }).stripCadreFiles,
      ).toHaveBeenCalledWith('abc123');
    });

    it('should call stripCadreFiles even when squashBeforePR is true', async () => {
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
        (ctx.io.commitManager as never as { stripCadreFiles: ReturnType<typeof vi.fn> }).stripCadreFiles,
      ).toHaveBeenCalledWith('abc123');
    });

    it('should use issue title as stripCadreFiles message fallback when PR title is empty', async () => {
      const resultParser = {
        parsePRContent: vi.fn().mockResolvedValue({ title: '', body: 'Body.' }),
      };
      const ctx = makeAutoCreateCtx({
        services: { resultParser: resultParser } as never,
      });
      await executor.execute(ctx);
      expect(
        (ctx.io.commitManager as never as { stripCadreFiles: ReturnType<typeof vi.fn> }).stripCadreFiles,
      ).toHaveBeenCalledWith('abc123');
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

    it('should pass labels from config to createPullRequest', async () => {
      const ctx = makeAutoCreateCtx({
        config: {
          options: { maxRetriesPerTask: 3 },
          pullRequest: { autoCreate: true, linkIssue: false, draft: false, labels: ['cadre-generated', 'bug'], reviewers: [] },
          commits: { squashBeforePR: false },
          baseBranch: 'main',
        } as never,
      });
      await executor.execute(ctx);
      expect(
        (ctx.platform as never as { createPullRequest: ReturnType<typeof vi.fn> }).createPullRequest,
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          labels: ['cadre-generated', 'bug'],
        }),
      );
    });

    it('should pass reviewers from config to createPullRequest', async () => {
      const ctx = makeAutoCreateCtx({
        config: {
          options: { maxRetriesPerTask: 3 },
          pullRequest: { autoCreate: true, linkIssue: false, draft: false, labels: [], reviewers: ['alice', 'bob'] },
          commits: { squashBeforePR: false },
          baseBranch: 'main',
        } as never,
      });
      await executor.execute(ctx);
      expect(
        (ctx.platform as never as { createPullRequest: ReturnType<typeof vi.fn> }).createPullRequest,
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          reviewers: ['alice', 'bob'],
        }),
      );
    });

    it('should pass both labels and reviewers when both are configured', async () => {
      const ctx = makeAutoCreateCtx({
        config: {
          options: { maxRetriesPerTask: 3 },
          pullRequest: { autoCreate: true, linkIssue: false, draft: false, labels: ['cadre-generated'], reviewers: ['reviewer1'] },
          commits: { squashBeforePR: false },
          baseBranch: 'main',
        } as never,
      });
      await executor.execute(ctx);
      expect(
        (ctx.platform as never as { createPullRequest: ReturnType<typeof vi.fn> }).createPullRequest,
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          labels: ['cadre-generated'],
          reviewers: ['reviewer1'],
        }),
      );
    });

    it('should pass empty labels array when labels config is empty', async () => {
      const ctx = makeAutoCreateCtx({
        config: {
          options: { maxRetriesPerTask: 3 },
          pullRequest: { autoCreate: true, linkIssue: false, draft: false, labels: [], reviewers: [] },
          commits: { squashBeforePR: false },
          baseBranch: 'main',
        } as never,
      });
      await executor.execute(ctx);
      expect(
        (ctx.platform as never as { createPullRequest: ReturnType<typeof vi.fn> }).createPullRequest,
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          labels: [],
          reviewers: [],
        }),
      );
    });

    it('should throw when createPullRequest fails', async () => {
      const platform = {
        issueLinkSuffix: vi.fn().mockReturnValue('Closes #42'),
        createPullRequest: vi.fn().mockRejectedValue(new Error('API rate limit')),
        updatePullRequest: vi.fn().mockResolvedValue(undefined),
        findOpenPR: vi.fn().mockResolvedValue(null),
      };
      const ctx = makeAutoCreateCtx({ platform: platform as never });
      await expect(executor.execute(ctx)).rejects.toThrow('API rate limit');
    });

    it('should call ctx.callbacks.setPR with the created PR info', async () => {
      const prInfo = { number: 77, url: 'https://github.com/owner/repo/pull/77', title: 'Fix' };
      const platform = {
        issueLinkSuffix: vi.fn().mockReturnValue(''),
        createPullRequest: vi.fn().mockResolvedValue(prInfo),
        updatePullRequest: vi.fn().mockResolvedValue(undefined),
        findOpenPR: vi.fn().mockResolvedValue(null),
      };
      const setPR = vi.fn();
      const ctx = makeAutoCreateCtx({
        platform: platform as never,
        callbacks: { setPR } as never,
      });

      await executor.execute(ctx);

      expect(setPR).toHaveBeenCalledWith(prInfo);
    });

    it('should not call ctx.callbacks.setPR when createPullRequest fails', async () => {
      const platform = {
        issueLinkSuffix: vi.fn().mockReturnValue(''),
        createPullRequest: vi.fn().mockRejectedValue(new Error('API error')),
        updatePullRequest: vi.fn().mockResolvedValue(undefined),
        findOpenPR: vi.fn().mockResolvedValue(null),
      };
      const setPR = vi.fn();
      const ctx = makeAutoCreateCtx({
        platform: platform as never,
        callbacks: { setPR } as never,
      });

      await expect(executor.execute(ctx)).rejects.toThrow('API error');
      expect(setPR).not.toHaveBeenCalled();
    });

    it('should not call ctx.callbacks.setPR when setPR is not provided', async () => {
      const prInfo = { number: 78, url: 'https://github.com/owner/repo/pull/78', title: 'Fix' };
      const platform = {
        issueLinkSuffix: vi.fn().mockReturnValue(''),
        createPullRequest: vi.fn().mockResolvedValue(prInfo),
        updatePullRequest: vi.fn().mockResolvedValue(undefined),
        findOpenPR: vi.fn().mockResolvedValue(null),
      };
      // No setPR in callbacks — should not throw
      const ctx = makeAutoCreateCtx({
        platform: platform as never,
      });

      await expect(executor.execute(ctx)).resolves.toBeDefined();
    });
  });

  describe('execute() with existing open PR (findOpenPR returns non-null)', () => {
    const existingPR = { number: 55, url: 'https://github.com/owner/repo/pull/55', title: 'Old title' };

    function makeExistingPRCtx(overrides: Partial<PhaseContext> = {}): PhaseContext {
      const platform = {
        issueLinkSuffix: vi.fn().mockReturnValue(''),
        createPullRequest: vi.fn().mockResolvedValue({ number: 99, url: 'https://github.com/owner/repo/pull/99' }),
        updatePullRequest: vi.fn().mockResolvedValue(undefined),
        findOpenPR: vi.fn().mockResolvedValue(existingPR),
      };
      return makeCtx({
        config: {
          options: { maxRetriesPerTask: 3 },
          pullRequest: { autoCreate: true, linkIssue: false, draft: false },
          commits: { squashBeforePR: false },
          baseBranch: 'main',
        } as never,
        platform: platform as never,
        ...overrides,
      });
    }

    it('should call findOpenPR with the issue number and branch', async () => {
      const ctx = makeExistingPRCtx();
      await executor.execute(ctx);
      expect(
        (ctx.platform as never as { findOpenPR: ReturnType<typeof vi.fn> }).findOpenPR,
      ).toHaveBeenCalledWith(42, 'cadre/issue-42');
    });

    it('should call updatePullRequest with existing PR number, new title, and new body', async () => {
      const ctx = makeExistingPRCtx();
      await executor.execute(ctx);
      expect(
        (ctx.platform as never as { updatePullRequest: ReturnType<typeof vi.fn> }).updatePullRequest,
      ).toHaveBeenCalledWith(
        55,
        expect.objectContaining({ title: 'Fix: resolve issue (#42)', body: 'This PR resolves the issue.' }),
      );
    });

    it('should NOT call createPullRequest when findOpenPR returns existing PR', async () => {
      const ctx = makeExistingPRCtx();
      await executor.execute(ctx);
      expect(
        (ctx.platform as never as { createPullRequest: ReturnType<typeof vi.fn> }).createPullRequest,
      ).not.toHaveBeenCalled();
    });

    it('should call ctx.callbacks.setPR with the existing PR object', async () => {
      const setPR = vi.fn();
      const ctx = makeExistingPRCtx({ callbacks: { setPR } as never });
      await executor.execute(ctx);
      expect(setPR).toHaveBeenCalledWith(existingPR);
    });
  });

  describe('execute() with findOpenPR returning null (new PR path)', () => {
    const newPR = { number: 99, url: 'https://github.com/owner/repo/pull/99', title: 'Fix: resolve issue (#42)' };

    function makeNullFindCtx(overrides: Partial<PhaseContext> = {}): PhaseContext {
      const platform = {
        issueLinkSuffix: vi.fn().mockReturnValue(''),
        createPullRequest: vi.fn().mockResolvedValue(newPR),
        updatePullRequest: vi.fn().mockResolvedValue(undefined),
        findOpenPR: vi.fn().mockResolvedValue(null),
      };
      return makeCtx({
        config: {
          options: { maxRetriesPerTask: 3 },
          pullRequest: { autoCreate: true, linkIssue: false, draft: false },
          commits: { squashBeforePR: false },
          baseBranch: 'main',
        } as never,
        platform: platform as never,
        ...overrides,
      });
    }

    it('should call createPullRequest when findOpenPR returns null', async () => {
      const ctx = makeNullFindCtx();
      await executor.execute(ctx);
      expect(
        (ctx.platform as never as { createPullRequest: ReturnType<typeof vi.fn> }).createPullRequest,
      ).toHaveBeenCalled();
    });

    it('should call ctx.callbacks.setPR with the newly created PR', async () => {
      const setPR = vi.fn();
      const ctx = makeNullFindCtx({ callbacks: { setPR } as never });
      await executor.execute(ctx);
      expect(setPR).toHaveBeenCalledWith(newPR);
    });
  });

  describe('execute() with isCadreSelfRun — label injection', () => {
    function makeSelfRunCtx(overrides: Partial<PhaseContext> = {}): PhaseContext {
      return makeCtx({
        config: {
          repository: 'jafreck/cadre',
          options: { maxRetriesPerTask: 3 },
          pullRequest: { autoCreate: true, linkIssue: false, draft: false, labels: [], reviewers: [] },
          commits: { squashBeforePR: false },
          baseBranch: 'main',
        } as never,
        ...overrides,
      });
    }

    it('should call ensureLabel before createPullRequest when isCadreSelfRun is true', async () => {
      const ensureLabel = vi.fn().mockResolvedValue(undefined);
      const createPullRequest = vi.fn().mockResolvedValue(undefined);
      const platform = {
        issueLinkSuffix: vi.fn().mockReturnValue(''),
        ensureLabel,
        createPullRequest,
        updatePullRequest: vi.fn().mockResolvedValue(undefined),
        findOpenPR: vi.fn().mockResolvedValue(null),
      };
      const ctx = makeSelfRunCtx({ platform: platform as never });
      await executor.execute(ctx);
      expect(ensureLabel).toHaveBeenCalledWith('cadre-generated');
      const ensureLabelOrder = ensureLabel.mock.invocationCallOrder[0];
      const createPROrder = createPullRequest.mock.invocationCallOrder[0];
      expect(ensureLabelOrder).toBeLessThan(createPROrder);
    });

    it('should inject cadre-generated into labels when isCadreSelfRun is true and labels is empty', async () => {
      const createPullRequest = vi.fn().mockResolvedValue(undefined);
      const platform = {
        issueLinkSuffix: vi.fn().mockReturnValue(''),
        ensureLabel: vi.fn().mockResolvedValue(undefined),
        createPullRequest,
        updatePullRequest: vi.fn().mockResolvedValue(undefined),
        findOpenPR: vi.fn().mockResolvedValue(null),
      };
      const ctx = makeSelfRunCtx({ platform: platform as never });
      await executor.execute(ctx);
      expect(createPullRequest).toHaveBeenCalledWith(
        expect.objectContaining({ labels: expect.arrayContaining(['cadre-generated']) }),
      );
    });

    it('should not duplicate cadre-generated if already in labels when isCadreSelfRun is true', async () => {
      const createPullRequest = vi.fn().mockResolvedValue(undefined);
      const platform = {
        issueLinkSuffix: vi.fn().mockReturnValue(''),
        ensureLabel: vi.fn().mockResolvedValue(undefined),
        createPullRequest,
        updatePullRequest: vi.fn().mockResolvedValue(undefined),
        findOpenPR: vi.fn().mockResolvedValue(null),
      };
      const ctx = makeCtx({
        config: {
          repository: 'jafreck/cadre',
          options: { maxRetriesPerTask: 3 },
          pullRequest: { autoCreate: true, linkIssue: false, draft: false, labels: ['cadre-generated', 'bug'], reviewers: [] },
          commits: { squashBeforePR: false },
          baseBranch: 'main',
        } as never,
        platform: platform as never,
      });
      await executor.execute(ctx);
      const callArgs = createPullRequest.mock.calls[0][0];
      const cadreCount = callArgs.labels.filter((l: string) => l === 'cadre-generated').length;
      expect(cadreCount).toBe(1);
    });

    it('should not call ensureLabel when isCadreSelfRun is false', async () => {
      const ensureLabel = vi.fn().mockResolvedValue(undefined);
      const platform = {
        issueLinkSuffix: vi.fn().mockReturnValue(''),
        ensureLabel,
        createPullRequest: vi.fn().mockResolvedValue(undefined),
        updatePullRequest: vi.fn().mockResolvedValue(undefined),
        findOpenPR: vi.fn().mockResolvedValue(null),
      };
      const ctx = makeCtx({
        config: {
          repository: 'other-owner/other-repo',
          options: { maxRetriesPerTask: 3 },
          pullRequest: { autoCreate: true, linkIssue: false, draft: false, labels: [], reviewers: [] },
          commits: { squashBeforePR: false },
          baseBranch: 'main',
        } as never,
        platform: platform as never,
      });
      await executor.execute(ctx);
      expect(ensureLabel).not.toHaveBeenCalled();
    });

    it('should pass labels unchanged when isCadreSelfRun is false', async () => {
      const createPullRequest = vi.fn().mockResolvedValue(undefined);
      const platform = {
        issueLinkSuffix: vi.fn().mockReturnValue(''),
        createPullRequest,
        updatePullRequest: vi.fn().mockResolvedValue(undefined),
        findOpenPR: vi.fn().mockResolvedValue(null),
      };
      const ctx = makeCtx({
        config: {
          repository: 'other-owner/other-repo',
          options: { maxRetriesPerTask: 3 },
          pullRequest: { autoCreate: true, linkIssue: false, draft: false, labels: ['my-label'], reviewers: [] },
          commits: { squashBeforePR: false },
          baseBranch: 'main',
        } as never,
        platform: platform as never,
      });
      await executor.execute(ctx);
      expect(createPullRequest).toHaveBeenCalledWith(
        expect.objectContaining({ labels: ['my-label'] }),
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
      const ctx = makeCtx({ services: { launcher: launcher } as never });
      await expect(executor.execute(ctx)).rejects.toThrow('PR composer failed:');
    });

    it('should throw if retryExecutor fails completely', async () => {
      const retryExecutor = {
        execute: vi.fn().mockResolvedValue({ success: false, error: 'max retries exceeded' }),
      };
      const ctx = makeCtx({ services: { retryExecutor: retryExecutor } as never });
      await expect(executor.execute(ctx)).rejects.toThrow('PR composer failed:');
    });

    it('should throw if pr-composer exits successfully but outputExists is false', async () => {
      const noOutputResult: AgentResult = {
        agent: 'pr-composer',
        success: true,
        exitCode: 0,
        timedOut: false,
        duration: 100,
        stdout: '',
        stderr: '',
        tokenUsage: 50,
        outputPath: '/progress/pr-content.md',
        outputExists: false,
      };
      const launcher = { launchAgent: vi.fn().mockResolvedValue(noOutputResult) };
      const ctx = makeCtx({ services: { launcher: launcher } as never });
      await expect(executor.execute(ctx)).rejects.toThrow(
        'pr-composer exited successfully but did not write pr-content.md',
      );
    });
  });

  describe('parse-validation feedback loop', () => {
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

    it('parse succeeds on first attempt — proceeds normally without re-invocation', async () => {
      const ctx = makeAutoCreateCtx();
      await executor.execute(ctx);
      // launchAgent called exactly once (no retry)
      expect(
        (ctx.services.launcher as never as { launchAgent: ReturnType<typeof vi.fn> }).launchAgent,
      ).toHaveBeenCalledTimes(1);
    });

    it('parse fails then succeeds on re-invocation — creates PR successfully', async () => {
      const parseError = new Error('Missing cadre-json block. Parse error: Unexpected token');
      const parsePRContent = vi.fn()
        .mockRejectedValueOnce(parseError)
        .mockResolvedValueOnce({ title: 'Fix', body: 'Body', labels: [] });
      const createPullRequest = vi.fn().mockResolvedValue(undefined);
      const platform = {
        issueLinkSuffix: vi.fn().mockReturnValue(''),
        createPullRequest,
        updatePullRequest: vi.fn().mockResolvedValue(undefined),
        findOpenPR: vi.fn().mockResolvedValue(null),
      };
      const ctx = makeAutoCreateCtx({
        services: { resultParser: { parsePRContent } as never } as never,
        platform: platform as never,
      });

      await executor.execute(ctx);

      // Agent should have been invoked twice (initial + 1 retry)
      expect(
        (ctx.services.launcher as never as { launchAgent: ReturnType<typeof vi.fn> }).launchAgent,
      ).toHaveBeenCalledTimes(2);
      // parsePRContent called twice (once failing, once succeeding)
      expect(parsePRContent).toHaveBeenCalledTimes(2);
      // PR was created after successful retry
      expect(createPullRequest).toHaveBeenCalled();
    });

    it('parse fails on all attempts — throws actionable error with parse failure cause', async () => {
      const parseError = new Error(
        'Agent output in /tmp/progress/pr-content.md is missing a `cadre-json` block. Parse error: Unexpected token x',
      );
      const parsePRContent = vi.fn().mockRejectedValue(parseError);
      const ctx = makeAutoCreateCtx({
        services: { resultParser: { parsePRContent } as never } as never,
      });

      await expect(executor.execute(ctx)).rejects.toThrow(
        /pr-composer output could not be parsed after \d+ attempt\(s\)/,
      );
      // The error includes the underlying parse failure cause
      await expect(executor.execute(ctx)).rejects.toThrow(/Parse error:/);
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
      const ctx = makeCtx({ services: { retryExecutor: retryExecutor } as never });
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
      const ctx = makeCtx({ services: { retryExecutor: retryExecutor } as never });
      await executor.execute(ctx);
      expect(descriptions).toContain('pr-composer');
    });
  });
});
