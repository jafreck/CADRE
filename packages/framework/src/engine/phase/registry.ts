/**
 * Generic phase definitions and registry for multi-phase pipelines.
 */

import type { PhaseContext, PhaseExecutor } from '../executor/phase-executor.js';
import { listGatePlugins, type GatePlugin, type PhaseGate } from '../gate/phase-gate.js';

export interface PhaseDefinition {
  /** Phase number (1-based). */
  id: number;
  /** Human-readable phase name. */
  name: string;
  /** Whether failure in this phase should abort the issue pipeline. */
  critical: boolean;
  /** Commit type for per-phase commits (e.g. 'chore', 'feat', 'fix'). */
  commitType?: string;
  /** Commit message template. Use `{issueNumber}` as a placeholder. */
  commitMessage?: string;
}

/** A single entry in the pipeline manifest, capturing all phase metadata. */
export interface PhaseManifestEntry<TContext extends PhaseContext = PhaseContext> {
  /** Phase number (1-based). */
  id: number;
  /** Human-readable phase name. */
  name: string;
  /** Factory that creates the phase executor. */
  executorFactory: () => PhaseExecutor<TContext>;
  /** Gate instance for post-phase validation, or null if no gate. */
  gate: PhaseGate | null;
  /** Whether failure in this phase should abort the issue pipeline. */
  critical: boolean;
  /** Commit type for per-phase commits (e.g. 'chore', 'feat', 'fix'). */
  commitType?: string;
  /** Commit message template. Use `{issueNumber}` as a placeholder. */
  commitMessage?: string;
  /** Whether this phase is included in the review-response pipeline. */
  includeInReviewResponse: boolean;
}

/**
 * Get a subset of phase definitions by ID, returned in phase-ID order.
 */
export function getPhaseSubset(phases: readonly PhaseDefinition[], ids: number[]): PhaseDefinition[] {
  return phases.filter((p) => ids.includes(p.id));
}

/**
 * Get a phase definition by ID.
 */
export function getPhase(phases: readonly PhaseDefinition[], phaseId: number): PhaseDefinition | undefined {
  return phases.find((p) => p.id === phaseId);
}

/**
 * Get the total number of phases.
 */
export function getPhaseCount(phases: readonly PhaseDefinition[]): number {
  return phases.length;
}

/**
 * Check if a phase is the last one.
 */
export function isLastPhase(phases: readonly PhaseDefinition[], phaseId: number): boolean {
  return phaseId === phases[phases.length - 1].id;
}

/**
 * Holds an ordered list of PhaseExecutor instances for the pipeline.
 */
export class PhaseRegistry<TContext extends PhaseContext = PhaseContext> {
  private executors: PhaseExecutor<TContext>[] = [];

  /** Append an executor to the registry. */
  register(executor: PhaseExecutor<TContext>): void {
    this.executors.push(executor);
  }

  /** Return all registered executors in registration order. */
  getAll(): PhaseExecutor<TContext>[] {
    return this.executors;
  }
}

/**
 * Build a PhaseRegistry populated from a manifest in phase-ID order.
 */
export function buildRegistry<TContext extends PhaseContext>(
  manifest: readonly PhaseManifestEntry<TContext>[],
): PhaseRegistry<TContext> {
  const registry = new PhaseRegistry<TContext>();
  for (const entry of manifest) {
    registry.register(entry.executorFactory());
  }
  return registry;
}

/**
 * Build a gate map from a manifest, keyed by phase ID.
 * When multiple gates target the same phase (from manifest + plugins), they
 * are composed: all gates run and their results are merged (errors/warnings
 * concatenated, worst status wins).
 */
export function buildGateMap<TContext extends PhaseContext>(
  manifest: readonly PhaseManifestEntry<TContext>[],
  plugins: readonly GatePlugin[] = listGatePlugins(),
): Record<number, PhaseGate> {
  // Collect all gates per phase
  const gatesPerPhase = new Map<number, PhaseGate[]>();
  for (const entry of manifest) {
    if (entry.gate !== null) {
      const existing = gatesPerPhase.get(entry.id) ?? [];
      existing.push(entry.gate);
      gatesPerPhase.set(entry.id, existing);
    }
  }
  for (const plugin of plugins) {
    const existing = gatesPerPhase.get(plugin.id) ?? [];
    existing.push(plugin.gate);
    gatesPerPhase.set(plugin.id, existing);
  }

  const map: Record<number, PhaseGate> = {};
  for (const [phaseId, gates] of gatesPerPhase) {
    if (gates.length === 1) {
      map[phaseId] = gates[0];
    } else {
      // Compose multiple gates into one
      map[phaseId] = {
        async validate(context) {
          const results = await Promise.all(gates.map((g) => g.validate(context)));
          const errors = results.flatMap((r) => r.errors);
          const warnings = results.flatMap((r) => r.warnings);
          const statuses = results.map((r) => r.status);
          const status = statuses.includes('fail') ? 'fail' : statuses.includes('warn') ? 'warn' : 'pass';
          return { status, errors, warnings };
        },
      };
    }
  }

  return map;
}
