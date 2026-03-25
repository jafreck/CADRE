import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/config/loader.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/config/loader.js')>();
  return {
    ...actual,
    loadConfig: vi.fn().mockResolvedValue({}),
    applyOverrides: vi.fn((config: unknown) => config),
  };
});

vi.mock('../src/core/runtime.js', () => ({
  CadreRuntime: vi.fn().mockImplementation(function () {
    return {
      run: vi.fn().mockResolvedValue({ success: true }),
    };
  }),
}));

const originalArgv = process.argv;

describe('src/index.ts barrel exports at runtime', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    process.argv = ['node', 'cadre', '--help'];
  });

  afterEach(() => {
    process.argv = originalArgv;
    vi.restoreAllMocks();
  });

  it('exports git classes from the module namespace when index is imported', async () => {
    vi.resetModules();

    const mod = await import('../src/index.js');

    expect(typeof mod.WorktreeProvisioner).toBe('function');
    expect(typeof mod.AgentFileSync).toBe('function');
    expect(typeof mod.WorktreeCleaner).toBe('function');
    expect(typeof mod.DependencyBranchMerger).toBe('function');

    expect(typeof mod.WorktreeProvisioner.prototype.provision).toBe('function');
    expect(typeof mod.AgentFileSync.prototype.syncAgentFiles).toBe('function');
    expect(typeof mod.WorktreeCleaner.prototype.remove).toBe('function');
    expect(typeof mod.DependencyBranchMerger.prototype.mergeDependencies).toBe('function');
  });
});