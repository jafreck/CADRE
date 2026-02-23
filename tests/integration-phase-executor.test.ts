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
  readFile: vi.fn().mockRejectedValue(new Error('ENOENT: no such file')),
}));

import { execShell } from '../src/util/process.js';
import { writeFile, readFile } from 'node:fs/promises';

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
        maxIntegrationFixRounds: 3,
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
    vi.resetAllMocks();
    vi.mocked(execShell).mockResolvedValue({ exitCode: 0, stdout: '', stderr: '', signal: null, timedOut: false });
    vi.mocked(writeFile).mockResolvedValue(undefined);
    vi.mocked(readFile).mockRejectedValue(new Error('ENOENT: no such file'));
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
        .mockResolvedValueOnce({ exitCode: 1, stdout: '', stderr: 'error TS2345: build error', signal: null, timedOut: false }) // build (fail)
        .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '', signal: null, timedOut: false }) // build re-run (pass)
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
        .mockResolvedValueOnce({ exitCode: 1, stdout: '× some failing test', stderr: '', signal: null, timedOut: false }) // test (fail)
        .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '', signal: null, timedOut: false }) // test re-run (pass)
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
        .mockResolvedValueOnce({ exitCode: 1, stdout: '', stderr: 'error TS2345: build err', signal: null, timedOut: false }) // build (fail)
        .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '', signal: null, timedOut: false }) // build re-run (pass)
        .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '', signal: null, timedOut: false }) // test
        .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '', signal: null, timedOut: false }); // lint

      const ctx = makeCtx();
      await executor.execute(ctx);

      expect(vi.mocked(writeFile)).toHaveBeenCalledWith(
        join('/tmp/progress', 'build-failure.txt'),
        expect.stringContaining('error TS2345: build err'),
        'utf-8',
      );
    });

    it('should record tokens from fix-surgeon after launch', async () => {
      vi.mocked(execShell)
        .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '', signal: null, timedOut: false }) // install
        .mockResolvedValueOnce({ exitCode: 1, stdout: '', stderr: 'error TS2345: build fail', signal: null, timedOut: false }) // build (fail)
        .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '', signal: null, timedOut: false }) // build re-run (pass)
        .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '', signal: null, timedOut: false }) // test
        .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '', signal: null, timedOut: false }); // lint

      const ctx = makeCtx();
      await executor.execute(ctx);
      expect(ctx.recordTokens).toHaveBeenCalledWith('fix-surgeon', 50);
    });

    it('should call checkBudget after fix-surgeon launches', async () => {
      vi.mocked(execShell)
        .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '', signal: null, timedOut: false }) // install
        .mockResolvedValueOnce({ exitCode: 1, stdout: '', stderr: 'error TS2345: build fail', signal: null, timedOut: false }) // build (fail)
        .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '', signal: null, timedOut: false }) // build re-run (pass)
        .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '', signal: null, timedOut: false }) // test
        .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '', signal: null, timedOut: false }); // lint

      const ctx = makeCtx();
      await executor.execute(ctx);
      expect(ctx.checkBudget).toHaveBeenCalled();
    });

    it('should include fail status in report for failed commands', async () => {
      vi.mocked(execShell)
        .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '', signal: null, timedOut: false }) // install
        .mockResolvedValueOnce({ exitCode: 1, stdout: 'error TS2345: type mismatch', stderr: '', signal: null, timedOut: false }) // build (fail round 1)
        .mockResolvedValueOnce({ exitCode: 1, stdout: 'error TS2345: type mismatch', stderr: '', signal: null, timedOut: false }) // build re-run (fail round 2)
        .mockResolvedValueOnce({ exitCode: 1, stdout: 'error TS2345: type mismatch', stderr: '', signal: null, timedOut: false }) // build re-run (fail round 3)
        .mockResolvedValueOnce({ exitCode: 1, stdout: 'error TS2345: type mismatch', stderr: '', signal: null, timedOut: false }) // final re-run after max rounds
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
        .mockResolvedValueOnce({ exitCode: 1, stdout: '', stderr: 'error TS2345: err', signal: null, timedOut: false }) // build (fail)
        .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '', signal: null, timedOut: false }) // build re-run (pass)
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
        .mockResolvedValueOnce({ exitCode: 1, stdout: '', stderr: 'error TS2345: err', signal: null, timedOut: false })
        .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '', signal: null, timedOut: false }) // build re-run (pass)
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

  describe('execute() - retry loop re-runs command after fix-surgeon', () => {
    it('should re-run build command after fix-surgeon and show pass when re-run succeeds', async () => {
      vi.mocked(execShell)
        .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '', signal: null, timedOut: false }) // install
        .mockResolvedValueOnce({ exitCode: 1, stdout: '', stderr: 'build err', signal: null, timedOut: false }) // build (fail)
        .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '', signal: null, timedOut: false }) // build re-run (pass)
        .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '', signal: null, timedOut: false }) // test
        .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '', signal: null, timedOut: false }); // lint

      const ctx = makeCtx();
      await executor.execute(ctx);

      const reportCall = vi.mocked(writeFile).mock.calls.find(
        (c) => typeof c[0] === 'string' && (c[0] as string).includes('integration-report.md'),
      );
      const content = reportCall?.[1] as string;
      expect(content).toContain('## Build');
      expect(content).toContain('**Status:** pass');
    });

    it('should re-run build command after fix-surgeon and show fail when re-run also fails', async () => {
      vi.mocked(execShell)
        .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '', signal: null, timedOut: false }) // install
        .mockResolvedValueOnce({ exitCode: 1, stdout: '', stderr: 'err1', signal: null, timedOut: false }) // build fail (round 1)
        .mockResolvedValueOnce({ exitCode: 1, stdout: '', stderr: 'err2', signal: null, timedOut: false }) // re-run fail (round 2)
        .mockResolvedValueOnce({ exitCode: 1, stdout: '', stderr: 'err3', signal: null, timedOut: false }) // re-run fail (round 3)
        .mockResolvedValueOnce({ exitCode: 1, stdout: '', stderr: 'err4', signal: null, timedOut: false }) // final re-run after loop
        .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '', signal: null, timedOut: false }) // test
        .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '', signal: null, timedOut: false }); // lint

      const ctx = makeCtx();
      await executor.execute(ctx);

      const reportCall = vi.mocked(writeFile).mock.calls.find(
        (c) => typeof c[0] === 'string' && (c[0] as string).includes('integration-report.md'),
      );
      const content = reportCall?.[1] as string;
      expect(content).toContain('## Build');
      expect(content).toContain('**Status:** fail');
    });

    it('should re-run test command after fix-surgeon and show pass when re-run succeeds', async () => {
      vi.mocked(execShell)
        .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '', signal: null, timedOut: false }) // install
        .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '', signal: null, timedOut: false }) // build
        .mockResolvedValueOnce({ exitCode: 1, stdout: '', stderr: 'test err', signal: null, timedOut: false }) // test (fail)
        .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '', signal: null, timedOut: false }) // test re-run (pass)
        .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '', signal: null, timedOut: false }); // lint

      const ctx = makeCtx();
      await executor.execute(ctx);

      const reportCall = vi.mocked(writeFile).mock.calls.find(
        (c) => typeof c[0] === 'string' && (c[0] as string).includes('integration-report.md'),
      );
      const content = reportCall?.[1] as string;
      expect(content).toContain('## Test');
      expect(content).toContain('**Status:** pass');
    });

    it('should re-run test command after fix-surgeon and show fail when re-run also fails', async () => {
      vi.mocked(execShell)
        .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '', signal: null, timedOut: false }) // install
        .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '', signal: null, timedOut: false }) // build
        .mockResolvedValueOnce({ exitCode: 1, stdout: '× failing test', stderr: '', signal: null, timedOut: false }) // test fail (round 1)
        .mockResolvedValueOnce({ exitCode: 1, stdout: '× failing test', stderr: '', signal: null, timedOut: false }) // re-run fail (round 2)
        .mockResolvedValueOnce({ exitCode: 1, stdout: '× failing test', stderr: '', signal: null, timedOut: false }) // re-run fail (round 3)
        .mockResolvedValueOnce({ exitCode: 1, stdout: '× failing test', stderr: '', signal: null, timedOut: false }) // final re-run after loop
        .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '', signal: null, timedOut: false }); // lint

      const ctx = makeCtx();
      await executor.execute(ctx);

      const reportCall = vi.mocked(writeFile).mock.calls.find(
        (c) => typeof c[0] === 'string' && (c[0] as string).includes('integration-report.md'),
      );
      const content = reportCall?.[1] as string;
      expect(content).toContain('## Test');
      expect(content).toContain('**Status:** fail');
    });

    it('should not exceed maxIntegrationFixRounds fix-surgeon invocations for build', async () => {
      const maxRounds = 2;
      // build fails every time: initial + 2 re-runs (after each fix) + final re-run check = 1 + 2 + 1 = 4 execShell calls for build
      vi.mocked(execShell)
        .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '', signal: null, timedOut: false }) // install
        .mockResolvedValue({ exitCode: 1, stdout: '', stderr: 'error TS2345: err', signal: null, timedOut: false }); // all build runs fail

      const ctx = makeCtx({
        config: {
          commands: { install: 'npm install', build: 'npm run build', test: undefined, lint: undefined },
          options: { buildVerification: true, testVerification: false, maxRetriesPerTask: 3, maxIntegrationFixRounds: maxRounds },
        } as never,
      });
      await executor.execute(ctx);

      const launchAgent = (ctx.launcher as never as { launchAgent: ReturnType<typeof vi.fn> }).launchAgent;
      expect(launchAgent).toHaveBeenCalledTimes(maxRounds);
    });

    it('should not exceed maxIntegrationFixRounds fix-surgeon invocations for test', async () => {
      const maxRounds = 2;
      vi.mocked(execShell)
        .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '', signal: null, timedOut: false }) // install
        .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '', signal: null, timedOut: false }) // build
        .mockResolvedValue({ exitCode: 1, stdout: '× failing test', stderr: '', signal: null, timedOut: false }); // all test runs fail

      const ctx = makeCtx({
        config: {
          commands: { install: 'npm install', build: 'npm run build', test: 'npm test', lint: undefined },
          options: { buildVerification: true, testVerification: true, maxRetriesPerTask: 3, maxIntegrationFixRounds: maxRounds },
        } as never,
      });
      await executor.execute(ctx);

      const launchAgent = (ctx.launcher as never as { launchAgent: ReturnType<typeof vi.fn> }).launchAgent;
      expect(launchAgent).toHaveBeenCalledTimes(maxRounds);
    });

    it('should exit retry loop early when build re-run passes', async () => {
      vi.mocked(execShell)
        .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '', signal: null, timedOut: false }) // install
        .mockResolvedValueOnce({ exitCode: 1, stdout: '', stderr: 'error TS2345: err', signal: null, timedOut: false }) // build fail
        .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '', signal: null, timedOut: false }) // build re-run pass (exit early)
        .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '', signal: null, timedOut: false }) // test
        .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '', signal: null, timedOut: false }); // lint

      const ctx = makeCtx({
        config: {
          commands: { install: 'npm install', build: 'npm run build', test: 'npm test', lint: undefined },
          options: { buildVerification: true, testVerification: true, maxRetriesPerTask: 3, maxIntegrationFixRounds: 3 },
        } as never,
      });
      await executor.execute(ctx);

      // fix-surgeon should only be called once (loop exits early)
      const launchAgent = (ctx.launcher as never as { launchAgent: ReturnType<typeof vi.fn> }).launchAgent;
      expect(launchAgent).toHaveBeenCalledTimes(1);
    });
  });

  describe('baseline reading', () => {
    it('should read baseline-results.json from .cadre directory in the worktree', async () => {
      const baseline = { buildExitCode: 0, testExitCode: 0, buildFailures: [], testFailures: [] };
      vi.mocked(readFile).mockResolvedValueOnce(JSON.stringify(baseline));

      const ctx = makeCtx();
      await executor.execute(ctx);

      expect(vi.mocked(readFile)).toHaveBeenCalledWith(
        join('/tmp/worktree', '.cadre', 'baseline-results.json'),
        'utf-8',
      );
    });

    it('should treat all current failures as regressions when no baseline file exists', async () => {
      // readFile already mocked to reject (ENOENT) in beforeEach
      vi.mocked(execShell)
        .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '', signal: null, timedOut: false }) // install
        .mockResolvedValueOnce({ exitCode: 1, stdout: '', stderr: 'error TS2345: brand new error', signal: null, timedOut: false }) // build fail
        .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '', signal: null, timedOut: false }) // build re-run pass
        .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '', signal: null, timedOut: false }) // test
        .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '', signal: null, timedOut: false }); // lint

      const ctx = makeCtx();
      await executor.execute(ctx);

      // Without baseline, any failure is a regression → fix-surgeon should be called
      expect(
        (ctx.launcher as never as { launchAgent: ReturnType<typeof vi.fn> }).launchAgent,
      ).toHaveBeenCalled();
    });
  });

  describe('baseline diffing - pre-existing failures should not trigger fix-surgeon', () => {
    it('should NOT call fix-surgeon when build failure matches a baseline build failure', async () => {
      const baseline = {
        buildExitCode: 1,
        testExitCode: 0,
        buildFailures: ['error TS2345: pre-existing build error'],
        testFailures: [],
      };
      vi.mocked(readFile).mockResolvedValueOnce(JSON.stringify(baseline));

      vi.mocked(execShell)
        .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '', signal: null, timedOut: false }) // install
        .mockResolvedValueOnce({ exitCode: 1, stdout: '', stderr: 'error TS2345: pre-existing build error', signal: null, timedOut: false }) // build fail (pre-existing)
        .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '', signal: null, timedOut: false }) // test
        .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '', signal: null, timedOut: false }); // lint

      const ctx = makeCtx();
      await executor.execute(ctx);

      expect(
        (ctx.launcher as never as { launchAgent: ReturnType<typeof vi.fn> }).launchAgent,
      ).not.toHaveBeenCalled();
    });

    it('should NOT call fix-surgeon when test failure matches a baseline test failure', async () => {
      const baseline = {
        buildExitCode: 0,
        testExitCode: 1,
        buildFailures: [],
        testFailures: ['some pre-existing test'],
      };
      vi.mocked(readFile).mockResolvedValueOnce(JSON.stringify(baseline));

      vi.mocked(execShell)
        .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '', signal: null, timedOut: false }) // install
        .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '', signal: null, timedOut: false }) // build
        .mockResolvedValueOnce({ exitCode: 1, stdout: '× some pre-existing test', stderr: '', signal: null, timedOut: false }) // test fail (pre-existing)
        .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '', signal: null, timedOut: false }); // lint

      const ctx = makeCtx();
      await executor.execute(ctx);

      expect(
        (ctx.launcher as never as { launchAgent: ReturnType<typeof vi.fn> }).launchAgent,
      ).not.toHaveBeenCalled();
    });

    it('should call fix-surgeon for a new build regression not in baseline', async () => {
      const baseline = {
        buildExitCode: 1,
        testExitCode: 0,
        buildFailures: ['error TS2345: old error'],
        testFailures: [],
      };
      vi.mocked(readFile).mockResolvedValueOnce(JSON.stringify(baseline));

      vi.mocked(execShell)
        .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '', signal: null, timedOut: false }) // install
        .mockResolvedValueOnce({ exitCode: 1, stdout: '', stderr: 'error TS2345: new regression error', signal: null, timedOut: false }) // build fail (new regression)
        .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '', signal: null, timedOut: false }) // build re-run pass
        .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '', signal: null, timedOut: false }) // test
        .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '', signal: null, timedOut: false }); // lint

      const ctx = makeCtx();
      await executor.execute(ctx);

      expect(
        (ctx.launcher as never as { launchAgent: ReturnType<typeof vi.fn> }).launchAgent,
      ).toHaveBeenCalledTimes(1);
    });

    it('should call fix-surgeon for a new test regression not in baseline', async () => {
      const baseline = {
        buildExitCode: 0,
        testExitCode: 1,
        buildFailures: [],
        testFailures: ['old pre-existing test'],
      };
      vi.mocked(readFile).mockResolvedValueOnce(JSON.stringify(baseline));

      vi.mocked(execShell)
        .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '', signal: null, timedOut: false }) // install
        .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '', signal: null, timedOut: false }) // build
        .mockResolvedValueOnce({ exitCode: 1, stdout: '× new regression test', stderr: '', signal: null, timedOut: false }) // test fail (new regression)
        .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '', signal: null, timedOut: false }) // test re-run pass
        .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '', signal: null, timedOut: false }); // lint

      const ctx = makeCtx();
      await executor.execute(ctx);

      expect(
        (ctx.launcher as never as { launchAgent: ReturnType<typeof vi.fn> }).launchAgent,
      ).toHaveBeenCalledTimes(1);
    });

    it('should loop only while regressions exist and exit when they are resolved', async () => {
      // baseline has one test failure; a second new failure appears then gets fixed
      const baseline = {
        buildExitCode: 0,
        testExitCode: 1,
        buildFailures: [],
        testFailures: ['pre-existing test'],
      };
      vi.mocked(readFile).mockResolvedValueOnce(JSON.stringify(baseline));

      vi.mocked(execShell)
        .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '', signal: null, timedOut: false }) // install
        .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '', signal: null, timedOut: false }) // build
        .mockResolvedValueOnce({ exitCode: 1, stdout: '× pre-existing test\n× new regression test', stderr: '', signal: null, timedOut: false }) // test fail (pre-existing + regression)
        .mockResolvedValueOnce({ exitCode: 1, stdout: '× pre-existing test', stderr: '', signal: null, timedOut: false }) // test re-run: only pre-existing remains → no regression
        .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '', signal: null, timedOut: false }); // lint

      const ctx = makeCtx();
      await executor.execute(ctx);

      // fix-surgeon called once (for the regression), loop exits after re-run shows only pre-existing
      const launchAgent = (ctx.launcher as never as { launchAgent: ReturnType<typeof vi.fn> }).launchAgent;
      expect(launchAgent).toHaveBeenCalledTimes(1);
    });

    it('should apply maxIntegrationFixRounds to regression rounds only, not pre-existing failures', async () => {
      // baseline has 1 pre-existing test failure; a new regression also appears and never gets fixed
      // maxRounds=1 → fix-surgeon called exactly 1 time (for the regression round),
      // even though the pre-existing failure persists throughout
      const maxRounds = 1;
      const baseline = {
        buildExitCode: 0,
        testExitCode: 1,
        buildFailures: [],
        testFailures: ['pre-existing test'],
      };
      vi.mocked(readFile).mockResolvedValueOnce(JSON.stringify(baseline));

      vi.mocked(execShell)
        .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '', signal: null, timedOut: false }) // install
        .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '', signal: null, timedOut: false }) // build
        .mockResolvedValue({ exitCode: 1, stdout: '× pre-existing test\n× new regression test', stderr: '', signal: null, timedOut: false }); // all test runs fail with both

      const ctx = makeCtx({
        config: {
          commands: { install: 'npm install', build: 'npm run build', test: 'npm test', lint: undefined },
          options: { buildVerification: true, testVerification: true, maxRetriesPerTask: 3, maxIntegrationFixRounds: maxRounds },
        } as never,
      });
      await executor.execute(ctx);

      // fix-surgeon called exactly maxRounds times (rounds applied to regression attempts, not pre-existing)
      const launchAgent = (ctx.launcher as never as { launchAgent: ReturnType<typeof vi.fn> }).launchAgent;
      expect(launchAgent).toHaveBeenCalledTimes(maxRounds);
    });
  });

  describe('report - Pre-existing Failures and New Regressions sections', () => {
    it('should include Pre-existing Failures section listing baseline failures that appear in current run', async () => {
      const baseline = {
        buildExitCode: 1,
        testExitCode: 1,
        buildFailures: ['error TS2345: old build error'],
        testFailures: ['old test failure'],
      };
      vi.mocked(readFile).mockResolvedValueOnce(JSON.stringify(baseline));

      vi.mocked(execShell)
        .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '', signal: null, timedOut: false }) // install
        .mockResolvedValueOnce({ exitCode: 1, stdout: '', stderr: 'error TS2345: old build error', signal: null, timedOut: false }) // build fail (pre-existing)
        .mockResolvedValueOnce({ exitCode: 1, stdout: '× old test failure', stderr: '', signal: null, timedOut: false }) // test fail (pre-existing)
        .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '', signal: null, timedOut: false }); // lint

      const ctx = makeCtx();
      await executor.execute(ctx);

      const reportCall = vi.mocked(writeFile).mock.calls.find(
        (c) => typeof c[0] === 'string' && (c[0] as string).includes('integration-report.md'),
      );
      const content = reportCall?.[1] as string;
      expect(content).toContain('## Pre-existing Failures');
      expect(content).toContain('error TS2345: old build error');
      expect(content).toContain('old test failure');
    });

    it('should show _None_ in Pre-existing Failures when no baseline exists', async () => {
      // readFile already mocked to reject (ENOENT) in beforeEach — no baseline
      const ctx = makeCtx();
      await executor.execute(ctx);

      const reportCall = vi.mocked(writeFile).mock.calls.find(
        (c) => typeof c[0] === 'string' && (c[0] as string).includes('integration-report.md'),
      );
      const content = reportCall?.[1] as string;
      expect(content).toContain('## Pre-existing Failures');
      expect(content).toContain('_None_');
    });

    it('should include New Regressions section in report', async () => {
      const ctx = makeCtx();
      await executor.execute(ctx);

      const reportCall = vi.mocked(writeFile).mock.calls.find(
        (c) => typeof c[0] === 'string' && (c[0] as string).includes('integration-report.md'),
      );
      const content = reportCall?.[1] as string;
      expect(content).toContain('## New Regressions');
    });

    it('should show _None_ in New Regressions when all commands pass', async () => {
      // All commands pass → no failures → no regressions
      const ctx = makeCtx();
      await executor.execute(ctx);

      const reportCall = vi.mocked(writeFile).mock.calls.find(
        (c) => typeof c[0] === 'string' && (c[0] as string).includes('integration-report.md'),
      );
      const content = reportCall?.[1] as string;
      expect(content).toContain('## New Regressions');
      expect(content).toContain('_None_');
    });

    it('should list new regression identifiers in New Regressions section', async () => {
      const baseline = { buildExitCode: 0, testExitCode: 0, buildFailures: [], testFailures: [] };
      vi.mocked(readFile).mockResolvedValueOnce(JSON.stringify(baseline));

      vi.mocked(execShell)
        .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '', signal: null, timedOut: false }) // install
        .mockResolvedValueOnce({ exitCode: 1, stdout: '', stderr: 'error TS2345: new regression error', signal: null, timedOut: false }) // build fail (regression)
        .mockResolvedValueOnce({ exitCode: 1, stdout: '', stderr: 'error TS2345: new regression error', signal: null, timedOut: false }) // re-run fail round 2
        .mockResolvedValueOnce({ exitCode: 1, stdout: '', stderr: 'error TS2345: new regression error', signal: null, timedOut: false }) // re-run fail round 3
        .mockResolvedValueOnce({ exitCode: 1, stdout: '', stderr: 'error TS2345: new regression error', signal: null, timedOut: false }) // final re-run
        .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '', signal: null, timedOut: false }) // test
        .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '', signal: null, timedOut: false }); // lint

      const ctx = makeCtx();
      await executor.execute(ctx);

      const reportCall = vi.mocked(writeFile).mock.calls.find(
        (c) => typeof c[0] === 'string' && (c[0] as string).includes('integration-report.md'),
      );
      const content = reportCall?.[1] as string;
      expect(content).toContain('## New Regressions');
      expect(content).toContain('error TS2345: new regression error');
    });

    it('should show _None_ in New Regressions when failure is pre-existing in baseline', async () => {
      const baseline = {
        buildExitCode: 1,
        testExitCode: 0,
        buildFailures: ['error TS2345: pre-existing error'],
        testFailures: [],
      };
      vi.mocked(readFile).mockResolvedValueOnce(JSON.stringify(baseline));

      vi.mocked(execShell)
        .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '', signal: null, timedOut: false }) // install
        .mockResolvedValueOnce({ exitCode: 1, stdout: '', stderr: 'error TS2345: pre-existing error', signal: null, timedOut: false }) // build fail (pre-existing, no regression)
        .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '', signal: null, timedOut: false }) // test
        .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '', signal: null, timedOut: false }); // lint

      const ctx = makeCtx();
      await executor.execute(ctx);

      const reportCall = vi.mocked(writeFile).mock.calls.find(
        (c) => typeof c[0] === 'string' && (c[0] as string).includes('integration-report.md'),
      );
      const content = reportCall?.[1] as string;
      expect(content).toContain('## New Regressions');
      expect(content).toContain('_None_');
    });
  });
});
