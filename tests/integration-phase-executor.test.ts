import { describe, it, expect, vi, beforeEach } from 'vitest';
import { join } from 'node:path';
import { IntegrationPhaseExecutor } from '../src/executors/integration-phase-executor.js';
import type { PhaseContext } from '../src/core/phase-executor.js';
import type { AgentResult } from '../src/agents/types.js';

vi.mock('../src/util/process.js', () => ({
  execShell: vi.fn().mockResolvedValue({ exitCode: 0, stdout: '', stderr: '', signal: null, timedOut: false }),
}));

vi.mock('node:fs/promises', () => ({
  writeFile: vi.fn().mockResolvedValue(undefined),
}));

import { execShell } from '../src/util/process.js';
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
    outputPath: '/progress/fix-result.md',
    outputExists: true,
  };
}

function makeCtx(overrides: Partial<PhaseContext> = {}): PhaseContext {
  const recordTokens = vi.fn();
  const checkBudget = vi.fn();

  const launcher = {
    launchAgent: vi.fn().mockResolvedValue(makeSuccessAgentResult('fix-surgeon')),
  };

  const contextBuilder = {
    buildForFixSurgeon: vi.fn().mockResolvedValue('/progress/fix-ctx.json'),
  };

  const commitManager = {
    isClean: vi.fn().mockResolvedValue(true),
    commit: vi.fn().mockResolvedValue(undefined),
    getChangedFiles: vi.fn().mockResolvedValue(['src/foo.ts']),
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
      commands: {
        install: 'npm install',
        build: 'npm run build',
        test: 'npm test',
        lint: 'npm run lint',
      },
      options: {
        buildVerification: true,
        testVerification: true,
        maxRetriesPerTask: 3,
      },
    } as never,
    progressDir: '/tmp/progress',
    contextBuilder: contextBuilder as never,
    launcher: launcher as never,
    resultParser: {} as never,
    checkpoint: {} as never,
    commitManager: commitManager as never,
    retryExecutor: {} as never,
    tokenTracker: {} as never,
    progressWriter: {} as never,
    platform: {} as never,
    recordTokens,
    checkBudget,
    logger: logger as never,
    ...overrides,
  };
}

describe('IntegrationPhaseExecutor', () => {
  let executor: IntegrationPhaseExecutor;

  beforeEach(() => {
    vi.clearAllMocks();
    executor = new IntegrationPhaseExecutor();
  });

  describe('PhaseExecutor contract', () => {
    it('should have phaseId of 4', () => {
      expect(executor.phaseId).toBe(4);
    });

    it('should have name "Integration Verification"', () => {
      expect(executor.name).toBe('Integration Verification');
    });

    it('should implement the PhaseExecutor interface', () => {
      expect(typeof executor.execute).toBe('function');
    });
  });

  describe('execute() happy path - all commands pass', () => {
    it('should return path to integration-report.md', async () => {
      const ctx = makeCtx();
      const result = await executor.execute(ctx);
      expect(result).toBe(join('/tmp/progress', 'integration-report.md'));
    });

    it('should run install command when configured', async () => {
      const ctx = makeCtx();
      await executor.execute(ctx);
      expect(vi.mocked(execShell)).toHaveBeenCalledWith('npm install', expect.objectContaining({ cwd: '/tmp/worktree' }));
    });

    it('should run build command when buildVerification is enabled', async () => {
      const ctx = makeCtx();
      await executor.execute(ctx);
      expect(vi.mocked(execShell)).toHaveBeenCalledWith('npm run build', expect.objectContaining({ cwd: '/tmp/worktree' }));
    });

    it('should run test command when testVerification is enabled', async () => {
      const ctx = makeCtx();
      await executor.execute(ctx);
      expect(vi.mocked(execShell)).toHaveBeenCalledWith('npm test', expect.objectContaining({ cwd: '/tmp/worktree' }));
    });

    it('should run lint command when configured', async () => {
      const ctx = makeCtx();
      await executor.execute(ctx);
      expect(vi.mocked(execShell)).toHaveBeenCalledWith('npm run lint', expect.objectContaining({ cwd: '/tmp/worktree' }));
    });

    it('should write integration report to progressDir/integration-report.md', async () => {
      const ctx = makeCtx();
      await executor.execute(ctx);
      expect(vi.mocked(writeFile)).toHaveBeenCalledWith(
        join('/tmp/progress', 'integration-report.md'),
        expect.stringContaining(`# Integration Report: Issue #42`),
        'utf-8',
      );
    });

    it('should include pass status in report for successful commands', async () => {
      const ctx = makeCtx();
      await executor.execute(ctx);
      const reportCall = vi.mocked(writeFile).mock.calls.find(
        (c) => typeof c[0] === 'string' && (c[0] as string).includes('integration-report.md'),
      );
      const content = reportCall?.[1] as string;
      expect(content).toContain('**Status:** pass');
    });

    it('should not commit when worktree is clean', async () => {
      const ctx = makeCtx();
      await executor.execute(ctx);
      expect(
        (ctx.commitManager as never as { commit: ReturnType<typeof vi.fn> }).commit,
      ).not.toHaveBeenCalled();
    });

    it('should commit when worktree is dirty', async () => {
      const commitManager = {
        isClean: vi.fn().mockResolvedValue(false),
        commit: vi.fn().mockResolvedValue(undefined),
        getChangedFiles: vi.fn().mockResolvedValue(['src/foo.ts']),
      };
      const ctx = makeCtx({ commitManager: commitManager as never });
      await executor.execute(ctx);
      expect(commitManager.commit).toHaveBeenCalledWith('address integration issues', 42, 'fix');
    });
  });

  describe('execute() - skip commands when not configured', () => {
    it('should skip install when install command is not set', async () => {
      const ctx = makeCtx({
        config: {
          commands: { build: 'npm run build', test: 'npm test', lint: undefined, install: undefined },
          options: { buildVerification: true, testVerification: true, maxRetriesPerTask: 3 },
        } as never,
      });
      await executor.execute(ctx);
      const calls = vi.mocked(execShell).mock.calls.map((c) => c[0]);
      expect(calls).not.toContain('npm install');
    });

    it('should skip build when buildVerification is false', async () => {
      const ctx = makeCtx({
        config: {
          commands: { install: 'npm install', build: 'npm run build', test: 'npm test', lint: undefined },
          options: { buildVerification: false, testVerification: true, maxRetriesPerTask: 3 },
        } as never,
      });
      await executor.execute(ctx);
      const calls = vi.mocked(execShell).mock.calls.map((c) => c[0]);
      expect(calls).not.toContain('npm run build');
    });

    it('should skip test when testVerification is false', async () => {
      const ctx = makeCtx({
        config: {
          commands: { install: 'npm install', build: 'npm run build', test: 'npm test', lint: undefined },
          options: { buildVerification: true, testVerification: false, maxRetriesPerTask: 3 },
        } as never,
      });
      await executor.execute(ctx);
      const calls = vi.mocked(execShell).mock.calls.map((c) => c[0]);
      expect(calls).not.toContain('npm test');
    });

    it('should skip lint when lint command is not set', async () => {
      const ctx = makeCtx({
        config: {
          commands: { install: 'npm install', build: 'npm run build', test: 'npm test', lint: undefined },
          options: { buildVerification: true, testVerification: true, maxRetriesPerTask: 3 },
        } as never,
      });
      await executor.execute(ctx);
      const calls = vi.mocked(execShell).mock.calls.map((c) => c[0]);
      expect(calls).not.toContain(undefined);
      expect(calls).toHaveLength(3);
    });
  });

  describe('execute() - fix-surgeon on build/test failure', () => {
    it('should call tryFixIntegration (launch fix-surgeon) when build fails', async () => {
      vi.mocked(execShell)
        .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '', signal: null, timedOut: false }) // install
        .mockResolvedValueOnce({ exitCode: 1, stdout: 'build output', stderr: 'build error', signal: null, timedOut: false }) // build
        .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '', signal: null, timedOut: false }) // test
        .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '', signal: null, timedOut: false }); // lint

      const ctx = makeCtx();
      await executor.execute(ctx);

      expect(
        (ctx.launcher as never as { launchAgent: ReturnType<typeof vi.fn> }).launchAgent,
      ).toHaveBeenCalledWith(
        expect.objectContaining({ agent: 'fix-surgeon', issueNumber: 42, phase: 4 }),
        '/tmp/worktree',
      );
    });

    it('should call tryFixIntegration (launch fix-surgeon) when test fails', async () => {
      vi.mocked(execShell)
        .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '', signal: null, timedOut: false }) // install
        .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '', signal: null, timedOut: false }) // build
        .mockResolvedValueOnce({ exitCode: 1, stdout: 'test output', stderr: 'test error', signal: null, timedOut: false }) // test
        .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '', signal: null, timedOut: false }); // lint

      const ctx = makeCtx();
      await executor.execute(ctx);

      expect(
        (ctx.launcher as never as { launchAgent: ReturnType<typeof vi.fn> }).launchAgent,
      ).toHaveBeenCalledWith(
        expect.objectContaining({ agent: 'fix-surgeon', issueNumber: 42, phase: 4 }),
        '/tmp/worktree',
      );
    });

    it('should NOT call fix-surgeon when lint fails', async () => {
      vi.mocked(execShell)
        .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '', signal: null, timedOut: false }) // install
        .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '', signal: null, timedOut: false }) // build
        .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '', signal: null, timedOut: false }) // test
        .mockResolvedValueOnce({ exitCode: 1, stdout: 'lint output', stderr: 'lint error', signal: null, timedOut: false }); // lint

      const ctx = makeCtx();
      await executor.execute(ctx);

      expect(
        (ctx.launcher as never as { launchAgent: ReturnType<typeof vi.fn> }).launchAgent,
      ).not.toHaveBeenCalled();
    });

    it('should write failure output to a file before launching fix-surgeon', async () => {
      vi.mocked(execShell)
        .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '', signal: null, timedOut: false }) // install
        .mockResolvedValueOnce({ exitCode: 1, stdout: 'build out', stderr: 'build err', signal: null, timedOut: false }) // build
        .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '', signal: null, timedOut: false }) // test
        .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '', signal: null, timedOut: false }); // lint

      const ctx = makeCtx();
      await executor.execute(ctx);

      expect(vi.mocked(writeFile)).toHaveBeenCalledWith(
        join('/tmp/progress', 'build-failure.txt'),
        expect.stringContaining('build err'),
        'utf-8',
      );
    });

    it('should record tokens from fix-surgeon after launch', async () => {
      vi.mocked(execShell)
        .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '', signal: null, timedOut: false }) // install
        .mockResolvedValueOnce({ exitCode: 1, stdout: '', stderr: 'build fail', signal: null, timedOut: false }) // build
        .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '', signal: null, timedOut: false }) // test
        .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '', signal: null, timedOut: false }); // lint

      const ctx = makeCtx();
      await executor.execute(ctx);
      expect(ctx.recordTokens).toHaveBeenCalledWith('fix-surgeon', 50);
    });

    it('should call checkBudget after fix-surgeon launches', async () => {
      vi.mocked(execShell)
        .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '', signal: null, timedOut: false }) // install
        .mockResolvedValueOnce({ exitCode: 1, stdout: '', stderr: 'build fail', signal: null, timedOut: false }) // build
        .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '', signal: null, timedOut: false }) // test
        .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '', signal: null, timedOut: false }); // lint

      const ctx = makeCtx();
      await executor.execute(ctx);
      expect(ctx.checkBudget).toHaveBeenCalled();
    });

    it('should include fail status in report for failed commands', async () => {
      vi.mocked(execShell)
        .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '', signal: null, timedOut: false }) // install
        .mockResolvedValueOnce({ exitCode: 1, stdout: 'out', stderr: 'err', signal: null, timedOut: false }) // build
        .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '', signal: null, timedOut: false }) // test
        .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '', signal: null, timedOut: false }); // lint

      const ctx = makeCtx();
      await executor.execute(ctx);
      const reportCall = vi.mocked(writeFile).mock.calls.find(
        (c) => typeof c[0] === 'string' && (c[0] as string).includes('integration-report.md'),
      );
      const content = reportCall?.[1] as string;
      expect(content).toContain('**Status:** fail');
    });
  });

  describe('tryFixIntegration - ImplementationTask construction', () => {
    it('should build fix-surgeon context using buildForFixSurgeon', async () => {
      vi.mocked(execShell)
        .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '', signal: null, timedOut: false }) // install
        .mockResolvedValueOnce({ exitCode: 1, stdout: '', stderr: 'err', signal: null, timedOut: false }) // build
        .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '', signal: null, timedOut: false }) // test
        .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '', signal: null, timedOut: false }); // lint

      const ctx = makeCtx();
      await executor.execute(ctx);

      expect(
        (ctx.contextBuilder as never as { buildForFixSurgeon: ReturnType<typeof vi.fn> }).buildForFixSurgeon,
      ).toHaveBeenCalledWith(
        42,
        '/tmp/worktree',
        expect.objectContaining({ id: 'integration-fix-build' }),
        join('/tmp/progress', 'build-failure.txt'),
        expect.any(Array),
        '/tmp/progress',
        'test-failure',
      );
    });

    it('should pass changed files from commitManager to buildForFixSurgeon', async () => {
      vi.mocked(execShell)
        .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '', signal: null, timedOut: false })
        .mockResolvedValueOnce({ exitCode: 1, stdout: '', stderr: 'err', signal: null, timedOut: false })
        .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '', signal: null, timedOut: false })
        .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '', signal: null, timedOut: false });

      const commitManager = {
        isClean: vi.fn().mockResolvedValue(true),
        commit: vi.fn().mockResolvedValue(undefined),
        getChangedFiles: vi.fn().mockResolvedValue(['src/changed.ts', 'src/other.ts']),
      };
      const ctx = makeCtx({ commitManager: commitManager as never });
      await executor.execute(ctx);

      expect(
        (ctx.contextBuilder as never as { buildForFixSurgeon: ReturnType<typeof vi.fn> }).buildForFixSurgeon,
      ).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        expect.objectContaining({ files: ['src/changed.ts', 'src/other.ts'] }),
        expect.anything(),
        [join('/tmp/worktree', 'src/changed.ts'), join('/tmp/worktree', 'src/other.ts')],
        expect.anything(),
        expect.anything(),
      );
    });
  });
});
