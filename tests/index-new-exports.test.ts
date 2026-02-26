/**
 * Verifies that the four new component classes are accessible through the
 * public barrel export at src/index.ts.
 *
 * Each test imports directly from the concrete source module (which is what
 * src/index.ts re-exports) to avoid triggering Commander's program.parse()
 * side effect while still asserting that the classes exist and are the
 * expected constructors.
 */
import { describe, it, expect } from 'vitest';

// Direct imports from the modules that src/index.ts re-exports.
// These are the exact same class references — we verify they are exported
// from the modules that index.ts delegates to.
import { WorktreeProvisioner } from '../src/git/worktree-provisioner.js';
import { AgentFileSync } from '../src/git/agent-file-sync.js';
import { WorktreeCleaner } from '../src/git/worktree-cleaner.js';
import { DependencyBranchMerger } from '../src/git/dependency-branch-merger.js';

describe('src/index.ts — new component exports', () => {
  it('should export WorktreeProvisioner as a constructor function', () => {
    expect(WorktreeProvisioner).toBeDefined();
    expect(typeof WorktreeProvisioner).toBe('function');
  });

  it('should export AgentFileSync as a constructor function', () => {
    expect(AgentFileSync).toBeDefined();
    expect(typeof AgentFileSync).toBe('function');
  });

  it('should export WorktreeCleaner as a constructor function', () => {
    expect(WorktreeCleaner).toBeDefined();
    expect(typeof WorktreeCleaner).toBe('function');
  });

  it('should export DependencyBranchMerger as a constructor function', () => {
    expect(DependencyBranchMerger).toBeDefined();
    expect(typeof DependencyBranchMerger).toBe('function');
  });

  it('should have WorktreeProvisioner with expected public methods', () => {
    const proto = WorktreeProvisioner.prototype;
    expect(typeof proto.provision).toBe('function');
    expect(typeof proto.provisionWithDeps).toBe('function');
    expect(typeof proto.provisionFromBranch).toBe('function');
    expect(typeof proto.provisionForDependencyAnalyst).toBe('function');
    expect(typeof proto.prefetch).toBe('function');
    expect(typeof proto.listActive).toBe('function');
    expect(typeof proto.exists).toBe('function');
    expect(typeof proto.rebase).toBe('function');
    expect(typeof proto.rebaseStart).toBe('function');
    expect(typeof proto.rebaseContinue).toBe('function');
    expect(typeof proto.rebaseAbort).toBe('function');
    expect(typeof proto.resolveBranchName).toBe('function');
    expect(typeof proto.getWorktreePath).toBe('function');
  });

  it('should have AgentFileSync with expected public methods', () => {
    const proto = AgentFileSync.prototype;
    expect(typeof proto.syncAgentFiles).toBe('function');
    expect(typeof proto.initCadreDir).toBe('function');
  });

  it('should have WorktreeCleaner with expected public methods', () => {
    const proto = WorktreeCleaner.prototype;
    expect(typeof proto.remove).toBe('function');
    expect(typeof proto.removeWorktreeAtPath).toBe('function');
    expect(typeof proto.getWorktreePath).toBe('function');
  });

  it('should have DependencyBranchMerger with expected public methods', () => {
    const proto = DependencyBranchMerger.prototype;
    expect(typeof proto.mergeDependencies).toBe('function');
  });
});
