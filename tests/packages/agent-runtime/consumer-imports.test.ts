/**
 * Verifies that consumer modules successfully resolve their imports from
 * @cadre/agent-runtime after the import migration (session-004).
 *
 * Each test dynamically imports a consumer module to confirm the barrel
 * re-exports satisfy all required symbols at runtime.
 */
import { describe, it, expect, vi } from 'vitest';

// ── Mock heavy dependencies so dynamic imports resolve without side-effects ──

vi.mock('simple-git', () => ({
  simpleGit: vi.fn(() => ({ diff: vi.fn() })),
}));

vi.mock('../../../src/core/phase-registry.js', () => ({
  buildGateMap: () => ({}),
}));

describe('consumer import compatibility (@cadre/agent-runtime)', () => {
  it('should resolve task-queue imports from agent-runtime', async () => {
    const mod = await import('../../../src/execution/task-queue.js');
    expect(mod.SessionQueue).toBeDefined();
    expect(mod.TaskQueue).toBeDefined();
  });

  it('should resolve gate-coordinator imports from agent-runtime', async () => {
    const mod = await import('../../../src/core/gate-coordinator.js');
    expect(mod.GateCoordinator).toBeDefined();
  });

  it('should resolve issue-budget-guard imports from agent-runtime', async () => {
    const mod = await import('../../../src/core/issue-budget-guard.js');
    expect(mod.IssueBudgetGuard).toBeDefined();
    expect(mod.BudgetExceededError).toBeDefined();
  });

  it('should resolve phase-executor type exports', async () => {
    const mod = await import('../../../src/core/phase-executor.js');
    // PhaseExecutor is a type, but PhaseServices is also a type — just verify module loads
    expect(mod).toBeDefined();
  });

  it('should resolve phase-gate imports from agent-runtime', async () => {
    const mod = await import('../../../src/core/phase-gate.js');
    expect(mod.AnalysisAmbiguityGate).toBeDefined();
  });

  it('should resolve phase-runner imports from agent-runtime', async () => {
    const mod = await import('../../../src/core/phase-runner.js');
    expect(mod.PhaseRunner).toBeDefined();
  });

  it('should resolve dependency-resolver imports from agent-runtime', async () => {
    const mod = await import('../../../src/core/dependency-resolver.js');
    expect(mod.DependencyResolver).toBeDefined();
    expect(mod.depMapSchema).toBeDefined();
  });

  it('should resolve fleet-orchestrator imports from agent-runtime', async () => {
    const mod = await import('../../../src/core/fleet-orchestrator.js');
    expect(mod.FleetOrchestrator).toBeDefined();
  });

  it('should resolve pr-composition-phase-executor imports from agent-runtime', async () => {
    const mod = await import('../../../src/executors/pr-composition-phase-executor.js');
    expect(mod.PRCompositionPhaseExecutor).toBeDefined();
  });

  it('should resolve issue-orchestrator imports from agent-runtime', async () => {
    const mod = await import('../../../src/core/issue-orchestrator.js');
    expect(mod.IssueOrchestrator).toBeDefined();
  });
});
