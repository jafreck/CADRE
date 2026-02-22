import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Use vi.hoisted so the same mock instance is shared across module reloads
const mockRunInit = vi.hoisted(() => vi.fn<(opts: { yes: boolean; repoPath?: string }) => Promise<void>>());

vi.mock('../src/cli/init.js', () => ({
  runInit: mockRunInit,
}));

vi.mock('../src/config/loader.js', () => ({
  loadConfig: vi.fn(),
  applyOverrides: vi.fn((c: unknown) => c),
}));

vi.mock('../src/core/runtime.js', () => ({
  CadreRuntime: vi.fn(),
}));

describe('cadre CLI — init command registration', () => {
  let originalArgv: string[];
  let mockExit: ReturnType<typeof vi.spyOn>;
  let mockConsoleError: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    originalArgv = process.argv;
    mockExit = vi.spyOn(process, 'exit').mockImplementation((() => {}) as never);
    mockConsoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.resetModules();
    mockRunInit.mockResolvedValue(undefined);
  });

  afterEach(() => {
    process.argv = originalArgv;
    vi.restoreAllMocks();
    mockRunInit.mockReset();
  });

  const importIndex = () => import('../src/index.js');
  const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

  it('should call runInit with yes=false and no repoPath when no flags are passed', async () => {
    process.argv = ['node', 'cadre', 'init'];

    await importIndex();
    await settle();

    expect(mockRunInit).toHaveBeenCalledOnce();
    expect(mockRunInit).toHaveBeenCalledWith({ yes: false, repoPath: undefined });
  });

  it('should call runInit with yes=true when --yes flag is passed', async () => {
    process.argv = ['node', 'cadre', 'init', '--yes'];

    await importIndex();
    await settle();

    expect(mockRunInit).toHaveBeenCalledWith({ yes: true, repoPath: undefined });
  });

  it('should call runInit with yes=true when -y short flag is passed', async () => {
    process.argv = ['node', 'cadre', 'init', '-y'];

    await importIndex();
    await settle();

    expect(mockRunInit).toHaveBeenCalledWith({ yes: true, repoPath: undefined });
  });

  it('should call runInit with the provided --repo-path value', async () => {
    process.argv = ['node', 'cadre', 'init', '--repo-path', '/tmp/myrepo'];

    await importIndex();
    await settle();

    expect(mockRunInit).toHaveBeenCalledWith({ yes: false, repoPath: '/tmp/myrepo' });
  });

  it('should call runInit with both --yes and --repo-path when both flags are provided', async () => {
    process.argv = ['node', 'cadre', 'init', '-y', '--repo-path', '/my/repo'];

    await importIndex();
    await settle();

    expect(mockRunInit).toHaveBeenCalledWith({ yes: true, repoPath: '/my/repo' });
  });

  it('should print the error message and call process.exit(1) when runInit throws', async () => {
    mockRunInit.mockRejectedValue(new Error('init failed'));
    process.argv = ['node', 'cadre', 'init'];

    await importIndex();
    await settle();

    expect(mockConsoleError).toHaveBeenCalledWith(expect.stringContaining('init failed'));
    expect(mockExit).toHaveBeenCalledWith(1);
  });

  it('should not call process.exit when runInit succeeds', async () => {
    process.argv = ['node', 'cadre', 'init'];

    await importIndex();
    await settle();

    expect(mockExit).not.toHaveBeenCalled();
  });
});
