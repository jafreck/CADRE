import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../src/cli/init.js', () => ({
  runInit: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../src/config/loader.js', () => ({
  loadConfig: vi.fn().mockResolvedValue({}),
  applyOverrides: vi.fn((c: unknown) => c),
}));

vi.mock('../src/core/runtime.js', () => ({
  CadreRuntime: vi.fn().mockImplementation(() => ({
    run: vi.fn().mockResolvedValue({ success: true }),
    status: vi.fn().mockResolvedValue(undefined),
    reset: vi.fn().mockResolvedValue(undefined),
    listWorktrees: vi.fn().mockResolvedValue(undefined),
    pruneWorktrees: vi.fn().mockResolvedValue(undefined),
  })),
}));

const originalArgv = process.argv;

async function loadIndexWith(args: string[]) {
  process.argv = ['node', 'index.js', ...args];
  vi.resetModules();
  // Re-import mocked runInit after resetModules
  const { runInit } = await import('../src/cli/init.js');
  await import('../src/index.js').catch(() => {
    // program.parse() may trigger process.exit via --help; swallow mocked exits
  });
  // Wait one microtask tick so async action handlers can run
  await new Promise((resolve) => setTimeout(resolve, 0));
  return { runInit: vi.mocked(runInit) };
}

describe('cadre CLI - init command', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(process, 'exit').mockImplementation((_code?: number) => {
      throw new Error(`process.exit(${_code})`);
    });
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    process.argv = originalArgv;
    vi.restoreAllMocks();
  });

  describe('command registration', () => {
    it('should list init in the top-level --help output', async () => {
      await loadIndexWith(['--help']).catch(() => {});
      const output = vi.mocked(process.stdout.write).mock.calls.map((c) => c[0]).join('');
      expect(output).toContain('init');
    });

    it('should show --yes option in init --help', async () => {
      await loadIndexWith(['init', '--help']).catch(() => {});
      const output = vi.mocked(process.stdout.write).mock.calls.map((c) => c[0]).join('');
      expect(output).toMatch(/--yes|-y/);
    });

    it('should show --repo-path option in init --help', async () => {
      await loadIndexWith(['init', '--help']).catch(() => {});
      const output = vi.mocked(process.stdout.write).mock.calls.map((c) => c[0]).join('');
      expect(output).toContain('--repo-path');
    });
  });

  describe('action dispatch', () => {
    it('should call runInit with yes=false when --yes flag is not provided', async () => {
      const { runInit } = await loadIndexWith(['init']);
      expect(runInit).toHaveBeenCalledWith({ yes: false, repoPath: undefined });
    });

    it('should call runInit with yes=true when --yes flag is provided', async () => {
      const { runInit } = await loadIndexWith(['init', '--yes']);
      expect(runInit).toHaveBeenCalledWith({ yes: true, repoPath: undefined });
    });

    it('should call runInit with yes=true when -y shorthand is provided', async () => {
      const { runInit } = await loadIndexWith(['init', '-y']);
      expect(runInit).toHaveBeenCalledWith({ yes: true, repoPath: undefined });
    });

    it('should call runInit with repoPath when --repo-path is provided', async () => {
      const { runInit } = await loadIndexWith(['init', '--repo-path', '/tmp/my-repo']);
      expect(runInit).toHaveBeenCalledWith({ yes: false, repoPath: '/tmp/my-repo' });
    });

    it('should call runInit with both yes=true and repoPath when both flags are provided', async () => {
      const { runInit } = await loadIndexWith(['init', '-y', '--repo-path', '/srv/project']);
      expect(runInit).toHaveBeenCalledWith({ yes: true, repoPath: '/srv/project' });
    });
  });

  describe('error handling', () => {
    it('should print error in red and exit with code 1 when runInit throws', async () => {
      vi.resetModules();
      process.argv = ['node', 'index.js', 'init'];
      // Don't throw from process.exit so the async action completes cleanly
      vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
      const { runInit } = await import('../src/cli/init.js');
      vi.mocked(runInit).mockRejectedValueOnce(new Error('init failed'));

      await import('../src/index.js').catch(() => {});
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(console.error).toHaveBeenCalledWith(expect.stringContaining('init failed'));
      expect(process.exit).toHaveBeenCalledWith(1);
    });

    it('should handle non-Error throws and print their string representation', async () => {
      vi.resetModules();
      process.argv = ['node', 'index.js', 'init'];
      // Don't throw from process.exit so the async action completes cleanly
      vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
      const { runInit } = await import('../src/cli/init.js');
      vi.mocked(runInit).mockRejectedValueOnce('string error');

      await import('../src/index.js').catch(() => {});
      await new Promise((resolve) => setTimeout(resolve, 10));

      expect(console.error).toHaveBeenCalledWith(expect.stringContaining('string error'));
      expect(process.exit).toHaveBeenCalledWith(1);
    });
  });

  describe('existing commands unaffected', () => {
    it('should still list run, status, reset, and worktrees in --help', async () => {
      await loadIndexWith(['--help']).catch(() => {});
      const output = vi.mocked(process.stdout.write).mock.calls.map((c) => c[0]).join('');
      expect(output).toContain('run');
      expect(output).toContain('status');
      expect(output).toContain('reset');
      expect(output).toContain('worktrees');
    });
  });
});
