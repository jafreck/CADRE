/**
 * Generic phase definitions and registry for multi-phase pipelines.
 */

import type { PhaseExecutor } from '../executor/phase-executor.js';
import type { PhaseGate } from '../gate/phase-gate.js';

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
export interface PhaseManifestEntry {
  /** Phase number (1-based). */
  phaseId: number;
  /** Human-readable phase name. */
  name: string;
  /** Factory that creates the phase executor. */
  executorFactory: () => PhaseExecutor;
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
export function getPhaseSubset(phases: PhaseDefinition[], ids: number[]): PhaseDefinition[] {
  return phases.filter((p) => ids.includes(p.id));
}

/**
 * Get a phase definition by ID.
 */
export function getPhase(phases: PhaseDefinition[], phaseId: number): PhaseDefinition | undefined {
  return phases.find((p) => p.id === phaseId);
}

/**
 * Get the total number of phases.
 */
export function getPhaseCount(phases: PhaseDefinition[]): number {
  return phases.length;
}

/**
 * Check if a phase is the last one.
 */
export function isLastPhase(phases: PhaseDefinition[], phaseId: number): boolean {
  return phaseId === phases[phases.length - 1].id;
}

/**
 * Holds an ordered list of PhaseExecutor instances for the pipeline.
 */
export class PhaseRegistry {
  private executors: PhaseExecutor[] = [];

  /** Append an executor to the registry. */
  register(executor: PhaseExecutor): void {
    this.executors.push(executor);
  }

  /** Return all registered executors in registration order. */
  getAll(): PhaseExecutor[] {
    return this.executors;
  }
}

/**
 * Build a PhaseRegistry populated from a manifest in phase-ID order.
 */
export function buildRegistry(manifest: readonly PhaseManifestEntry[]): PhaseRegistry {
  const registry = new PhaseRegistry();
  for (const entry of manifest) {
    registry.register(entry.executorFactory());
  }
  return registry;
}

/**
 * Build a gate map from a manifest, keyed by phase ID.
 */
export function buildGateMap(manifest: readonly PhaseManifestEntry[]): Record<number, PhaseGate> {
  const map: Record<number, PhaseGate> = {};
  for (const entry of manifest) {
    if (entry.gate !== null) {
      map[entry.phaseId] = entry.gate;
    }
  }
  return map;
}
