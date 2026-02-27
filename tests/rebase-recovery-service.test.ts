import { describe, it, expect, vi, beforeEach } from 'vitest';
import { RebaseRecoveryService } from '../src/core/rebase-recovery-service.js';

vi.mock('../src/logging/logger.js', () => ({
  Logger: vi.fn(),
}));

function makeWorktreeManager() {
  return {
    rebaseStart: vi.fn().mockResolvedValue({ status: 'clean' }),
    rebaseContinue: vi.fn().mockResolvedValue({ success: true }),
    rebaseAbort: vi.fn().mockResolvedValue(undefined),
  };
}

function makeLauncher() {
  return {
    launchAgent: vi.fn().mockResolvedValue({
      success: true,
      exitCode: 0,
      timedOut: false,
      duration: 100,
      agent: 'conflict-resolver',
      outputExists: true,
      outputPath: '/tmp/issues/1/conflict-resolution-report.md',
      stdout: '',
      stderr: '',
    }),
  };
}

function makeContextBuilder() {
  return {
    buildForConflictResolver: vi.fn().mockResolvedValue('/tmp/contexts/conflict.json'),
  };
}

function makeLogger() {
  return {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    child: vi.fn().mockReturnThis(),
  };
}

describe('RebaseRecoveryService', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('rebaseAndResolveConflicts', () => {
    it('should complete without launching conflict-resolver when rebase is clean', async () => {
      const wm = makeWorktreeManager();
      const launcher = makeLauncher();
      const ctx = makeContextBuilder();
      const logger = makeLogger();
      const service = new RebaseRecoveryService(wm as any, launcher as any, ctx as any, logger as any);

      await service.rebaseAndResolveConflicts(1, 10, '/tmp/worktree/1', '/tmp/progress');

      expect(wm.rebaseStart).toHaveBeenCalledWith(1);
      expect(launcher.launchAgent).not.toHaveBeenCalled();
      expect(wm.rebaseContinue).not.toHaveBeenCalled();
    });

    it('should launch conflict-resolver when rebase has conflicts', async () => {
      const wm = makeWorktreeManager();
      wm.rebaseStart.mockResolvedValue({
        status: 'conflict',
        conflictedFiles: ['src/foo.ts'],
      });
      const launcher = makeLauncher();
      const ctx = makeContextBuilder();
      const logger = makeLogger();
      const service = new RebaseRecoveryService(wm as any, launcher as any, ctx as any, logger as any);

      await service.rebaseAndResolveConflicts(1, 10, '/tmp/worktree/1', '/tmp/progress');

      expect(ctx.buildForConflictResolver).toHaveBeenCalledWith(
        1,
        '/tmp/worktree/1',
        ['src/foo.ts'],
        '/tmp/progress',
      );
      expect(launcher.launchAgent).toHaveBeenCalledWith(
        expect.objectContaining({
          agent: 'conflict-resolver',
          issueNumber: 1,
          phase: 0,
        }),
        '/tmp/worktree/1',
      );
      expect(wm.rebaseContinue).toHaveBeenCalledWith(1);
    });

    it('should skip conflict-resolver and go straight to rebaseContinue when 0 conflicted files', async () => {
      const wm = makeWorktreeManager();
      wm.rebaseStart.mockResolvedValue({
        status: 'conflict',
        conflictedFiles: [],
      });
      const launcher = makeLauncher();
      const ctx = makeContextBuilder();
      const logger = makeLogger();
      const service = new RebaseRecoveryService(wm as any, launcher as any, ctx as any, logger as any);

      await service.rebaseAndResolveConflicts(1, 10, '/tmp/worktree/1', '/tmp/progress');

      expect(launcher.launchAgent).not.toHaveBeenCalled();
      expect(wm.rebaseContinue).toHaveBeenCalledWith(1);
      expect(logger.info).toHaveBeenCalledWith(
        expect.stringContaining('0 conflicted files'),
        expect.objectContaining({ issueNumber: 1 }),
      );
    });

    it('should abort rebase and throw when conflict-resolver agent fails', async () => {
      const wm = makeWorktreeManager();
      wm.rebaseStart.mockResolvedValue({
        status: 'conflict',
        conflictedFiles: ['src/foo.ts'],
      });
      const launcher = makeLauncher();
      launcher.launchAgent.mockResolvedValue({
        success: false,
        exitCode: 1,
        timedOut: false,
        duration: 100,
        agent: 'conflict-resolver',
        outputExists: false,
        stdout: '',
        stderr: 'build error',
      });
      const ctx = makeContextBuilder();
      const logger = makeLogger();
      const service = new RebaseRecoveryService(wm as any, launcher as any, ctx as any, logger as any);

      await expect(
        service.rebaseAndResolveConflicts(1, 10, '/tmp/worktree/1', '/tmp/progress'),
      ).rejects.toThrow('Conflict-resolver agent failed for PR #10 (exit 1)');

      expect(wm.rebaseAbort).toHaveBeenCalledWith(1);
      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining('exit 1'),
        expect.objectContaining({ issueNumber: 1 }),
      );
    });

    it('should abort rebase and throw when conflict-resolver agent times out', async () => {
      const wm = makeWorktreeManager();
      wm.rebaseStart.mockResolvedValue({
        status: 'conflict',
        conflictedFiles: ['src/foo.ts'],
      });
      const launcher = makeLauncher();
      launcher.launchAgent.mockResolvedValue({
        success: false,
        exitCode: null,
        timedOut: true,
        duration: 300000,
        agent: 'conflict-resolver',
        outputExists: false,
        stdout: '',
        stderr: '',
      });
      const ctx = makeContextBuilder();
      const logger = makeLogger();
      const service = new RebaseRecoveryService(wm as any, launcher as any, ctx as any, logger as any);

      await expect(
        service.rebaseAndResolveConflicts(1, 10, '/tmp/worktree/1', '/tmp/progress'),
      ).rejects.toThrow('timed out after 300000ms');

      expect(wm.rebaseAbort).toHaveBeenCalledWith(1);
    });

    it('should abort rebase and throw when conflict-resolver exits 0 but produces no output', async () => {
      const wm = makeWorktreeManager();
      wm.rebaseStart.mockResolvedValue({
        status: 'conflict',
        conflictedFiles: ['src/foo.ts'],
      });
      const launcher = makeLauncher();
      launcher.launchAgent.mockResolvedValue({
        success: true,
        exitCode: 0,
        timedOut: false,
        duration: 100,
        agent: 'conflict-resolver',
        outputExists: false,
        outputPath: '/tmp/report.md',
        stdout: '',
        stderr: '',
      });
      const ctx = makeContextBuilder();
      const logger = makeLogger();
      const service = new RebaseRecoveryService(wm as any, launcher as any, ctx as any, logger as any);

      await expect(
        service.rebaseAndResolveConflicts(1, 10, '/tmp/worktree/1', '/tmp/progress'),
      ).rejects.toThrow('produced no output');

      expect(wm.rebaseAbort).toHaveBeenCalledWith(1);
      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining('produced no output'),
        expect.objectContaining({ issueNumber: 1 }),
      );
    });

    it('should abort rebase and throw when rebaseContinue fails', async () => {
      const wm = makeWorktreeManager();
      wm.rebaseStart.mockResolvedValue({
        status: 'conflict',
        conflictedFiles: ['src/foo.ts'],
      });
      wm.rebaseContinue.mockResolvedValue({
        success: false,
        error: 'Conflicts remain',
        conflictedFiles: ['src/foo.ts'],
      });
      const launcher = makeLauncher();
      const ctx = makeContextBuilder();
      const logger = makeLogger();
      const service = new RebaseRecoveryService(wm as any, launcher as any, ctx as any, logger as any);

      await expect(
        service.rebaseAndResolveConflicts(1, 10, '/tmp/worktree/1', '/tmp/progress'),
      ).rejects.toThrow('Rebase --continue failed');

      expect(wm.rebaseAbort).toHaveBeenCalledWith(1);
      expect(logger.error).toHaveBeenCalledWith(
        expect.stringContaining('Rebase --continue failed'),
        expect.objectContaining({
          issueNumber: 1,
          data: expect.objectContaining({ conflictedFiles: ['src/foo.ts'] }),
        }),
      );
    });

    it('should succeed after conflict resolution and rebaseContinue', async () => {
      const wm = makeWorktreeManager();
      wm.rebaseStart.mockResolvedValue({
        status: 'conflict',
        conflictedFiles: ['src/foo.ts'],
      });
      wm.rebaseContinue.mockResolvedValue({ success: true });
      const launcher = makeLauncher();
      const ctx = makeContextBuilder();
      const logger = makeLogger();
      const service = new RebaseRecoveryService(wm as any, launcher as any, ctx as any, logger as any);

      await expect(
        service.rebaseAndResolveConflicts(1, 10, '/tmp/worktree/1', '/tmp/progress'),
      ).resolves.toBeUndefined();
    });

    it('should not call rebaseContinue or rebaseAbort when rebase is clean', async () => {
      const wm = makeWorktreeManager();
      wm.rebaseStart.mockResolvedValue({ status: 'clean' });
      const launcher = makeLauncher();
      const ctx = makeContextBuilder();
      const logger = makeLogger();
      const service = new RebaseRecoveryService(wm as any, launcher as any, ctx as any, logger as any);

      await service.rebaseAndResolveConflicts(1, 10, '/tmp/worktree/1', '/tmp/progress');

      expect(wm.rebaseContinue).not.toHaveBeenCalled();
      expect(wm.rebaseAbort).not.toHaveBeenCalled();
    });
  });
});
