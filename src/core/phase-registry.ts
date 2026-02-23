/**
 * Phase definitions and ordering for CADRE's per-issue pipeline.
 */

import type { PhaseExecutor } from './phase-executor.js';

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

export const ISSUE_PHASES: PhaseDefinition[] = [
  { id: 1, name: 'Analysis & Scouting', critical: true, commitType: 'chore', commitMessage: 'analyze issue #{issueNumber}' },
  { id: 2, name: 'Planning', critical: true, commitType: 'chore', commitMessage: 'plan implementation for #{issueNumber}' },
  { id: 3, name: 'Implementation', critical: true, commitType: 'feat', commitMessage: 'implement changes for #{issueNumber}' },
  { id: 4, name: 'Integration Verification', critical: false, commitType: 'fix', commitMessage: 'address integration issues' },
  { id: 5, name: 'PR Composition', critical: false, commitType: 'chore', commitMessage: 'compose PR for #{issueNumber}' },
];

/** Phase IDs used by the review-response pipeline (implementation, integration-verification, PR composition). */
export const REVIEW_RESPONSE_PHASES: readonly number[] = [3, 4, 5];

/**
 * Get a subset of phase definitions by ID, returned in phase-ID order.
 */
export function getPhaseSubset(ids: number[]): PhaseDefinition[] {
  return ISSUE_PHASES.filter((p) => ids.includes(p.id));
}

/**
 * Get a phase definition by ID.
 */
export function getPhase(phaseId: number): PhaseDefinition | undefined {
  return ISSUE_PHASES.find((p) => p.id === phaseId);
}

/**
 * Get the total number of phases in the pipeline.
 */
export function getPhaseCount(): number {
  return ISSUE_PHASES.length;
}

/**
 * Check if a phase is the last one.
 */
export function isLastPhase(phaseId: number): boolean {
  return phaseId === ISSUE_PHASES[ISSUE_PHASES.length - 1].id;
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
