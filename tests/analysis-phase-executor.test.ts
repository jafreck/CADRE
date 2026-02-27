import { describe, it, expect, vi, beforeEach } from 'vitest';
import { join } from 'node:path';
import { AnalysisPhaseExecutor } from '../src/executors/analysis-phase-executor.js';
import type { PhaseContext } from '../src/core/phase-executor.js';
import type { AgentResult } from '../src/agents/types.js';

vi.mock('../src/util/fs.js', () => ({
  ensureDir: vi.fn().mockResolvedValue(undefined),
  atomicWriteJSON: vi.fn().mockResolvedValue(undefined),
  listFilesRecursive: vi.fn().mockResolvedValue([]),
}));

vi.mock('node:fs/promises', () => ({
  writeFile: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../src/util/process.js', () => ({
  execShell: vi.fn().mockResolvedValue({ exitCode: 0, stdout: '', stderr: '' }),
}));

import { ensureDir, atomicWriteJSON, listFilesRecursive } from '../src/util/fs.js';
import { writeFile } from 'node:fs/promises';
import { execShell } from '../src/util/process.js';

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

  const analystResult = makeSuccessAgentResult('issue-analyst');
  const scoutResult = makeSuccessAgentResult('codebase-scout');

  const launcher = {
    launchAgent: vi.fn()
      .mockResolvedValueOnce(analystResult)
      .mockResolvedValueOnce(scoutResult),
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
    build: vi.fn()
      .mockResolvedValueOnce('/progress/analyst-ctx.json')
      .mockResolvedValue('/progress/scout-ctx.json'),
  };

  const services = {
    launcher: launcher as never,
    retryExecutor: retryExecutor as never,
    tokenTracker: {} as never,
    contextBuilder: contextBuilder as never,
    resultParser: {} as never,
    logger: {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    } as never,
  };

  const io = {
    progressDir: '/tmp/progress',
    progressWriter: {} as never,
    checkpoint: {} as never,
    commitManager: {} as never,
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
      commands: {},
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

describe('AnalysisPhaseExecutor', () => {
  let executor: AnalysisPhaseExecutor;

  beforeEach(() => {
    vi.clearAllMocks();
    executor = new AnalysisPhaseExecutor();
  });

  describe('PhaseExecutor contract', () => {
    it('should have phaseId of 1', () => {
      expect(executor.phaseId).toBe(1);
    });

    it('should have name "Analysis & Scouting"', () => {
      expect(executor.name).toBe('Analysis & Scouting');
    });

    it('should implement the PhaseExecutor interface', () => {
      expect(typeof executor.execute).toBe('function');
    });
  });

  describe('execute() happy path', () => {
    it('should ensure the progressDir exists', async () => {
      const ctx = makeCtx();
      await executor.execute(ctx);
      expect(ensureDir).toHaveBeenCalledWith('/tmp/progress');
    });

    it('should write the issue JSON to progressDir/issue.json', async () => {
      const ctx = makeCtx();
      await executor.execute(ctx);
      expect(atomicWriteJSON).toHaveBeenCalledWith(
        join('/tmp/progress', 'issue.json'),
        ctx.issue,
      );
    });

    it('should list files in the worktree', async () => {
      const ctx = makeCtx();
      await executor.execute(ctx);
      expect(listFilesRecursive).toHaveBeenCalledWith('/tmp/worktree');
    });

    it('should write the file tree to progressDir/repo-file-tree.txt', async () => {
      vi.mocked(listFilesRecursive).mockResolvedValue(['src/main.ts', 'README.md']);
      const ctx = makeCtx();
      await executor.execute(ctx);
      expect(writeFile).toHaveBeenCalledWith(
        join('/tmp/progress', 'repo-file-tree.txt'),
        'src/main.ts\nREADME.md',
        'utf-8',
      );
    });

    it('should filter .cadre/ files from the file tree', async () => {
      vi.mocked(listFilesRecursive).mockResolvedValue([
        '.cadre/issues/8/state.json',
        'src/main.ts',
        '.cadre/worktrees/issue-8/foo.ts',
        'README.md',
      ]);
      const ctx = makeCtx();
      await executor.execute(ctx);
      expect(writeFile).toHaveBeenCalledWith(
        join('/tmp/progress', 'repo-file-tree.txt'),
        'src/main.ts\nREADME.md',
        'utf-8',
      );
    });

    it('should build context for issue-analyst with correct args', async () => {
      const ctx = makeCtx();
      await executor.execute(ctx);
      expect((ctx.services.contextBuilder as never as { build: ReturnType<typeof vi.fn> }).build)
        .toHaveBeenCalledWith(
          'issue-analyst',
          expect.objectContaining({
            issueNumber: 42,
            worktreePath: '/tmp/worktree',
            issueJsonPath: join('/tmp/progress', 'issue.json'),
            progressDir: '/tmp/progress',
          }),
        );
    });

    it('should launch issue-analyst with correct invocation', async () => {
      const ctx = makeCtx();
      await executor.execute(ctx);
      expect((ctx.services.launcher as never as { launchAgent: ReturnType<typeof vi.fn> }).launchAgent)
        .toHaveBeenCalledWith(
          expect.objectContaining({
            agent: 'issue-analyst',
            issueNumber: 42,
            phase: 1,
            contextPath: '/progress/analyst-ctx.json',
            outputPath: join('/tmp/progress', 'analysis.md'),
          }),
          '/tmp/worktree',
        );
    });

    it('should build context for codebase-scout after analyst succeeds', async () => {
      const ctx = makeCtx();
      await executor.execute(ctx);
      expect((ctx.services.contextBuilder as never as { build: ReturnType<typeof vi.fn> }).build)
        .toHaveBeenCalledWith(
          'codebase-scout',
          expect.objectContaining({
            issueNumber: 42,
            worktreePath: '/tmp/worktree',
            analysisPath: join('/tmp/progress', 'analysis.md'),
            fileTreePath: join('/tmp/progress', 'repo-file-tree.txt'),
            progressDir: '/tmp/progress',
          }),
        );
    });

    it('should launch codebase-scout with correct invocation', async () => {
      const ctx = makeCtx();
      await executor.execute(ctx);
      expect((ctx.services.launcher as never as { launchAgent: ReturnType<typeof vi.fn> }).launchAgent)
        .toHaveBeenCalledWith(
          expect.objectContaining({
            agent: 'codebase-scout',
            issueNumber: 42,
            phase: 1,
            contextPath: '/progress/scout-ctx.json',
            outputPath: join('/tmp/progress', 'scout-report.md'),
          }),
          '/tmp/worktree',
        );
    });

    it('should return path to scout-report.md', async () => {
      const ctx = makeCtx();
      const result = await executor.execute(ctx);
      expect(result).toBe(join('/tmp/progress', 'scout-report.md'));
    });

    it('should record tokens for both agents', async () => {
      const ctx = makeCtx();
      await executor.execute(ctx);
      expect(ctx.callbacks.recordTokens).toHaveBeenCalledWith('issue-analyst', 50);
      expect(ctx.callbacks.recordTokens).toHaveBeenCalledWith('codebase-scout', 50);
    });

    it('should check budget multiple times during execution', async () => {
      const ctx = makeCtx();
      await executor.execute(ctx);
      // checkBudget is called: before each launchAgent, after recordTokens, and after retryExecutor.execute
      expect(ctx.callbacks.checkBudget).toHaveBeenCalled();
      expect((ctx.callbacks.checkBudget as ReturnType<typeof vi.fn>).mock.calls.length).toBeGreaterThanOrEqual(4);
    });
  });

  describe('execute() error handling', () => {
    it('should throw if issue-analyst fails', async () => {
      const analystResult: AgentResult = {
        agent: 'issue-analyst',
        success: false,
        exitCode: 1,
        timedOut: false,
        duration: 100,
        stdout: '',
        stderr: 'analyst error',
        tokenUsage: null,
        outputPath: '',
        outputExists: false,
        error: 'analyst error',
      };

      const launcher = {
        launchAgent: vi.fn().mockResolvedValue(analystResult),
      };

      const ctx = makeCtx({ services: { launcher: launcher } as never });
      await expect(executor.execute(ctx)).rejects.toThrow('Issue analyst failed:');
    });

    it('should throw if codebase-scout fails', async () => {
      const analystResult = makeSuccessAgentResult('issue-analyst');
      const scoutResult: AgentResult = {
        agent: 'codebase-scout',
        success: false,
        exitCode: 1,
        timedOut: false,
        duration: 100,
        stdout: '',
        stderr: 'scout error',
        tokenUsage: null,
        outputPath: '',
        outputExists: false,
        error: 'scout error',
      };

      const launcher = {
        launchAgent: vi.fn()
          .mockResolvedValueOnce(analystResult)
          .mockResolvedValueOnce(scoutResult),
      };

      const ctx = makeCtx({ services: { launcher: launcher } as never });
      await expect(executor.execute(ctx)).rejects.toThrow('Codebase scout failed:');
    });

    it('should not launch codebase-scout if issue-analyst fails', async () => {
      const analystResult: AgentResult = {
        agent: 'issue-analyst',
        success: false,
        exitCode: 1,
        timedOut: false,
        duration: 100,
        stdout: '',
        stderr: '',
        tokenUsage: null,
        outputPath: '',
        outputExists: false,
        error: 'analyst failed',
      };

      const launcher = {
        launchAgent: vi.fn().mockResolvedValue(analystResult),
      };

      const ctx = makeCtx({ services: { launcher: launcher } as never });
      await expect(executor.execute(ctx)).rejects.toThrow();
      // Only one call — for the analyst. Scout should not be launched.
      expect((ctx.services.launcher as never as { launchAgent: ReturnType<typeof vi.fn> }).launchAgent)
        .toHaveBeenCalledTimes(1);
    });

    it('should return a failure AgentResult when retryExecutor fails completely', async () => {
      // retryExecutor returns { success: false } without a result — simulates max retries exhausted
      const retryExecutor = {
        execute: vi.fn().mockResolvedValue({ success: false, error: 'max retries exceeded' }),
      };

      const ctx = makeCtx({ services: { retryExecutor: retryExecutor } as never });

      // The failure result from launchWithRetry should be treated as a failed agent result
      // causing execute() to throw "Issue analyst failed:"
      await expect(executor.execute(ctx)).rejects.toThrow('Issue analyst failed:');
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

      expect(descriptions).toContain('issue-analyst');
      expect(descriptions).toContain('codebase-scout');
    });
  });

  describe('captureBaseline()', () => {
    const baselinePath = '/tmp/worktree/.cadre/baseline-results.json';

    it('should write baseline with zeros and empty arrays when no commands configured', async () => {
      const ctx = makeCtx();
      await executor.execute(ctx);
      expect(atomicWriteJSON).toHaveBeenCalledWith(baselinePath, {
        buildExitCode: 0,
        testExitCode: 0,
        buildFailures: [],
        testFailures: [],
      });
    });

    it('should run build command when configured and record exit code 0 on success', async () => {
      vi.mocked(execShell).mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '' });
      const ctx = makeCtx({
        config: { options: { maxRetriesPerTask: 3 }, commands: { build: 'npm run build' } } as never,
      });
      await executor.execute(ctx);
      expect(execShell).toHaveBeenCalledWith('npm run build', expect.objectContaining({ cwd: '/tmp/worktree' }));
      expect(atomicWriteJSON).toHaveBeenCalledWith(baselinePath, expect.objectContaining({ buildExitCode: 0 }));
    });

    it('should record non-zero buildExitCode when build command fails', async () => {
      vi.mocked(execShell).mockResolvedValueOnce({ exitCode: 1, stdout: 'FAIL src/foo.ts', stderr: '' });
      const ctx = makeCtx({
        config: { options: { maxRetriesPerTask: 3 }, commands: { build: 'npm run build' } } as never,
      });
      await executor.execute(ctx);
      expect(atomicWriteJSON).toHaveBeenCalledWith(baselinePath, expect.objectContaining({ buildExitCode: 1 }));
    });

    it('should extract buildFailures from output when build fails', async () => {
      vi.mocked(execShell).mockResolvedValueOnce({
        exitCode: 1,
        stdout: 'FAIL src/foo.test.ts\nsome other line',
        stderr: '',
      });
      const ctx = makeCtx({
        config: { options: { maxRetriesPerTask: 3 }, commands: { build: 'npm run build' } } as never,
      });
      await executor.execute(ctx);
      expect(atomicWriteJSON).toHaveBeenCalledWith(baselinePath, expect.objectContaining({
        buildFailures: ['src/foo.test.ts'],
      }));
    });

    it('should run test command when configured and record exit code 0 on success', async () => {
      vi.mocked(execShell).mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '' });
      const ctx = makeCtx({
        config: { options: { maxRetriesPerTask: 3 }, commands: { test: 'npx vitest run' } } as never,
      });
      await executor.execute(ctx);
      expect(execShell).toHaveBeenCalledWith('npx vitest run', expect.objectContaining({ cwd: '/tmp/worktree' }));
      expect(atomicWriteJSON).toHaveBeenCalledWith(baselinePath, expect.objectContaining({ testExitCode: 0 }));
    });

    it('should record non-zero testExitCode and extract testFailures when tests fail', async () => {
      vi.mocked(execShell).mockResolvedValueOnce({
        exitCode: 1,
        stdout: '✗ should do something\n× another failing test',
        stderr: '',
      });
      const ctx = makeCtx({
        config: { options: { maxRetriesPerTask: 3 }, commands: { test: 'npx vitest run' } } as never,
      });
      await executor.execute(ctx);
      expect(atomicWriteJSON).toHaveBeenCalledWith(baselinePath, expect.objectContaining({
        testExitCode: 1,
        testFailures: expect.arrayContaining(['should do something', 'another failing test']),
      }));
    });

    it('should run both build and test commands when both are configured', async () => {
      vi.mocked(execShell)
        .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '' })
        .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '' });
      const ctx = makeCtx({
        config: {
          options: { maxRetriesPerTask: 3 },
          commands: { build: 'npm run build', test: 'npm test' },
        } as never,
      });
      await executor.execute(ctx);
      expect(execShell).toHaveBeenCalledTimes(2);
      expect(execShell).toHaveBeenCalledWith('npm run build', expect.any(Object));
      expect(execShell).toHaveBeenCalledWith('npm test', expect.any(Object));
    });

    it('should not throw and should still write baseline when both commands fail', async () => {
      vi.mocked(execShell)
        .mockResolvedValueOnce({ exitCode: 1, stdout: 'FAILED build', stderr: '' })
        .mockResolvedValueOnce({ exitCode: 2, stdout: 'FAILED tests', stderr: '' });
      const ctx = makeCtx({
        config: {
          options: { maxRetriesPerTask: 3 },
          commands: { build: 'npm run build', test: 'npm test' },
        } as never,
      });
      await expect(executor.execute(ctx)).resolves.toBeDefined();
      expect(atomicWriteJSON).toHaveBeenCalledWith(baselinePath, expect.objectContaining({
        buildExitCode: 1,
        testExitCode: 2,
      }));
    });

    it('should log warning and write baseline when execShell throws', async () => {
      vi.mocked(execShell).mockRejectedValueOnce(new Error('spawn failed'));
      const ctx = makeCtx({
        config: { options: { maxRetriesPerTask: 3 }, commands: { build: 'npm run build' } } as never,
      });
      await expect(executor.execute(ctx)).resolves.toBeDefined();
      expect((ctx.services.logger as never as { warn: ReturnType<typeof vi.fn> }).warn).toHaveBeenCalledWith(
        expect.stringContaining('spawn failed'),
      );
      expect(atomicWriteJSON).toHaveBeenCalledWith(baselinePath, {
        buildExitCode: 0,
        testExitCode: 0,
        buildFailures: [],
        testFailures: [],
      });
    });

    it('should deduplicate identical failure lines', async () => {
      vi.mocked(execShell).mockResolvedValueOnce({
        exitCode: 1,
        stdout: 'FAIL src/foo.ts\nFAIL src/foo.ts',
        stderr: '',
      });
      const ctx = makeCtx({
        config: { options: { maxRetriesPerTask: 3 }, commands: { build: 'npm run build' } } as never,
      });
      await executor.execute(ctx);
      expect(atomicWriteJSON).toHaveBeenCalledWith(baselinePath, expect.objectContaining({
        buildFailures: ['src/foo.ts'],
      }));
    });

    it('should extract error: lines from output as failures', async () => {
      vi.mocked(execShell).mockResolvedValueOnce({
        exitCode: 1,
        stdout: '',
        stderr: 'error: Cannot find module foo',
      });
      const ctx = makeCtx({
        config: { options: { maxRetriesPerTask: 3 }, commands: { build: 'tsc' } } as never,
      });
      await executor.execute(ctx);
      expect(atomicWriteJSON).toHaveBeenCalledWith(baselinePath, expect.objectContaining({
        buildFailures: expect.arrayContaining([expect.stringContaining('error: Cannot find module foo')]),
      }));
    });
  });

  describe('captureBaseline() with runWithRetry', () => {
    const baselinePath = '/tmp/worktree/.cadre/baseline-results.json';

    it('should treat null exit code from build as buildExitCode 1', async () => {
      vi.mocked(execShell).mockResolvedValueOnce({ exitCode: null as unknown as number, stdout: '', stderr: '' });
      const ctx = makeCtx({
        config: { options: { maxRetriesPerTask: 3 }, commands: { build: 'npm run build' } } as never,
      });
      await executor.execute(ctx);
      expect(atomicWriteJSON).toHaveBeenCalledWith(baselinePath, expect.objectContaining({ buildExitCode: 1 }));
    });

    it('should treat null exit code from test as testExitCode 1', async () => {
      vi.mocked(execShell).mockResolvedValueOnce({ exitCode: null as unknown as number, stdout: '', stderr: '' });
      const ctx = makeCtx({
        config: { options: { maxRetriesPerTask: 3 }, commands: { test: 'npm test' } } as never,
      });
      await executor.execute(ctx);
      expect(atomicWriteJSON).toHaveBeenCalledWith(baselinePath, expect.objectContaining({ testExitCode: 1 }));
    });

    it('should not attempt retries during baseline capture (maxFixRounds=0)', async () => {
      vi.mocked(execShell).mockResolvedValueOnce({ exitCode: 1, stdout: 'FAIL src/a.ts', stderr: '' });
      const ctx = makeCtx({
        config: { options: { maxRetriesPerTask: 3 }, commands: { build: 'npm run build' } } as never,
      });
      await executor.execute(ctx);
      // Only one call to execShell for the build command — no retry
      expect(execShell).toHaveBeenCalledTimes(1);
    });
  });
});
