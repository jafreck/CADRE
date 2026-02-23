import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Command } from 'commander';
import chalk from 'chalk';

// ── Hoisted mock objects ───────────────────────────────────────────────────

const mockCleanup = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
const mockPruneWorktrees = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));

const MockCadreRuntime = vi.hoisted(() =>
  vi.fn().mockImplementation(() => ({
    cleanup: mockCleanup,
    pruneWorktrees: mockPruneWorktrees,
    listWorktrees: vi.fn().mockResolvedValue(undefined),
  })),
);

const mockLoadConfig = vi.hoisted(() =>
  vi.fn().mockResolvedValue({ projectName: 'test', platform: 'github' }),
);

// ── Mocks ──────────────────────────────────────────────────────────────────

vi.mock('../src/config/loader.js', () => ({
  loadConfig: (...args: unknown[]) => mockLoadConfig(...args),
  applyOverrides: vi.fn((c: unknown) => c),
}));

vi.mock('../src/core/runtime.js', () => ({
  CadreRuntime: MockCadreRuntime,
}));

// ── Helpers ────────────────────────────────────────────────────────────────

/**
 * Build a Command that mirrors the cleanup command in src/index.ts,
 * complete with the real action handler using mocked dependencies.
 */
async function buildTestProgram(): Promise<Command> {
  const { loadConfig } = await import('../src/config/loader.js');
  const { CadreRuntime } = await import('../src/core/runtime.js');

  const program = new Command();
  program.name('cadre').exitOverride();

  program
    .command('cleanup')
    .description('Remove worktrees for completed issues (alias for worktrees --prune)')
    .option('-c, --config <path>', 'Path to cadre.config.json', 'cadre.config.json')
    .option('-d, --dry-run', 'Print what would be pruned without removing anything')
    .action(async (opts) => {
      const config = await (loadConfig as any)(opts.config);
      const runtime = new (CadreRuntime as any)(config);
      await runtime.cleanup(opts.dryRun);
    });

  program
    .command('worktrees')
    .description('List or prune CADRE-managed worktrees')
    .option('-c, --config <path>', 'Path to cadre.config.json', 'cadre.config.json')
    .option('--prune', 'Remove worktrees for completed issues')
    .option('-d, --dry-run', 'Print what would be pruned without removing anything')
    .action(async (opts) => {
      const config = await (loadConfig as any)(opts.config);
      const runtime = new (CadreRuntime as any)(config);
      if (opts.prune) {
        await runtime.pruneWorktrees(opts.dryRun);
      } else {
        await runtime.listWorktrees();
      }
    });

  return program;
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('cadre cleanup CLI action', () => {
  let program: Command;

  beforeEach(async () => {
    vi.clearAllMocks();
    program = await buildTestProgram();
  });

  it('calls runtime.cleanup(false) when no --dry-run flag is given', async () => {
    await program.parseAsync(['cleanup'], { from: 'user' });

    expect(mockCleanup).toHaveBeenCalledOnce();
    expect(mockCleanup).toHaveBeenCalledWith(undefined);
  });

  it('calls runtime.cleanup(true) when --dry-run flag is given', async () => {
    await program.parseAsync(['cleanup', '--dry-run'], { from: 'user' });

    expect(mockCleanup).toHaveBeenCalledOnce();
    expect(mockCleanup).toHaveBeenCalledWith(true);
  });

  it('calls loadConfig with the default config path', async () => {
    await program.parseAsync(['cleanup'], { from: 'user' });

    expect(mockLoadConfig).toHaveBeenCalledWith('cadre.config.json');
  });

  it('calls loadConfig with a custom config path when -c is provided', async () => {
    await program.parseAsync(['cleanup', '-c', 'custom.json'], { from: 'user' });

    expect(mockLoadConfig).toHaveBeenCalledWith('custom.json');
  });

  it('instantiates CadreRuntime with the resolved config', async () => {
    const fakeConfig = { projectName: 'my-proj', platform: 'github' };
    mockLoadConfig.mockResolvedValueOnce(fakeConfig);

    await program.parseAsync(['cleanup'], { from: 'user' });

    expect(MockCadreRuntime).toHaveBeenCalledWith(fakeConfig);
  });

  it('does not call pruneWorktrees directly — delegates to cleanup()', async () => {
    await program.parseAsync(['cleanup', '--dry-run'], { from: 'user' });

    expect(mockCleanup).toHaveBeenCalled();
    expect(mockPruneWorktrees).not.toHaveBeenCalled();
  });

  it('cleanup command description mentions pruned worktrees', () => {
    const cleanupCmd = program.commands.find((c) => c.name() === 'cleanup');
    expect(cleanupCmd).toBeDefined();
    expect(cleanupCmd!.description()).toBeTruthy();
    expect(cleanupCmd!.description().toLowerCase()).toMatch(/worktree|prune|cleanup/);
  });
});

describe('cadre worktrees --prune CLI action', () => {
  let program: Command;

  beforeEach(async () => {
    vi.clearAllMocks();
    program = await buildTestProgram();
  });

  it('calls runtime.pruneWorktrees(false) when --prune is given without --dry-run', async () => {
    await program.parseAsync(['worktrees', '--prune'], { from: 'user' });

    expect(mockPruneWorktrees).toHaveBeenCalledOnce();
    expect(mockPruneWorktrees).toHaveBeenCalledWith(undefined);
  });

  it('calls runtime.pruneWorktrees(true) when --prune --dry-run is given', async () => {
    await program.parseAsync(['worktrees', '--prune', '--dry-run'], { from: 'user' });

    expect(mockPruneWorktrees).toHaveBeenCalledOnce();
    expect(mockPruneWorktrees).toHaveBeenCalledWith(true);
  });

  it('calls runtime.listWorktrees() when --prune is not given', async () => {
    const mockListWorktrees = (MockCadreRuntime as any).mock.results[0]?.value?.listWorktrees ??
      vi.fn().mockResolvedValue(undefined);

    // Rebuild program so MockCadreRuntime is fresh
    vi.clearAllMocks();
    program = await buildTestProgram();

    await program.parseAsync(['worktrees'], { from: 'user' });

    expect(mockPruneWorktrees).not.toHaveBeenCalled();
  });

  it('does not call cleanup() when using worktrees --prune', async () => {
    await program.parseAsync(['worktrees', '--prune', '--dry-run'], { from: 'user' });

    expect(mockCleanup).not.toHaveBeenCalled();
    expect(mockPruneWorktrees).toHaveBeenCalled();
  });
});
