/**
 * Phase definitions and ordering for CADRE's per-issue pipeline.
 */

import type { PhaseExecutor } from './phase-executor.js';
import type { PhaseGate } from './phase-gate.js';
import {
  AnalysisToPlanningGate,
  ImplementationToIntegrationGate,
  IntegrationToPRGate,
  PlanningToImplementationGate,
} from './phase-gate.js';
import { AnalysisPhaseExecutor } from '../executors/analysis-phase-executor.js';
import { PlanningPhaseExecutor } from '../executors/planning-phase-executor.js';
import { ImplementationPhaseExecutor } from '../executors/implementation-phase-executor.js';
import { IntegrationPhaseExecutor } from '../executors/integration-phase-executor.js';
import { PRCompositionPhaseExecutor } from '../executors/pr-composition-phase-executor.js';

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
  { id: 4, name: 'Integration Verification', critical: true, commitType: 'fix', commitMessage: 'address integration issues' },
  { id: 5, name: 'PR Composition', critical: true, commitType: 'chore', commitMessage: 'compose PR for #{issueNumber}' },
];

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

/** Single source of truth for all pipeline phase metadata. */
export const PHASE_MANIFEST: readonly PhaseManifestEntry[] = [
  {
    phaseId: 1,
    name: 'Analysis & Scouting',
    executorFactory: () => new AnalysisPhaseExecutor(),
    gate: new AnalysisToPlanningGate(),
    critical: true,
    commitType: 'chore',
    commitMessage: 'analyze issue #{issueNumber}',
    includeInReviewResponse: false,
  },
  {
    phaseId: 2,
    name: 'Planning',
    executorFactory: () => new PlanningPhaseExecutor(),
    gate: new PlanningToImplementationGate(),
    critical: true,
    commitType: 'chore',
    commitMessage: 'plan implementation for #{issueNumber}',
    includeInReviewResponse: false,
  },
  {
    phaseId: 3,
    name: 'Implementation',
    executorFactory: () => new ImplementationPhaseExecutor(),
    gate: new ImplementationToIntegrationGate(),
    critical: true,
    commitType: 'feat',
    commitMessage: 'implement changes for #{issueNumber}',
    includeInReviewResponse: true,
  },
  {
    phaseId: 4,
    name: 'Integration Verification',
    executorFactory: () => new IntegrationPhaseExecutor(),
    gate: new IntegrationToPRGate(),
    critical: true,
    commitType: 'fix',
    commitMessage: 'address integration issues',
    includeInReviewResponse: true,
  },
  {
    phaseId: 5,
    name: 'PR Composition',
    executorFactory: () => new PRCompositionPhaseExecutor(),
    gate: null,
    critical: true,
    commitType: 'chore',
    commitMessage: 'compose PR for #{issueNumber}',
    includeInReviewResponse: true,
  },
];

/** Phase IDs used by the review-response pipeline (implementation, integration-verification, PR composition). */
export const REVIEW_RESPONSE_PHASES: readonly number[] = PHASE_MANIFEST
  .filter((e) => e.includeInReviewResponse)
  .map((e) => e.phaseId);

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

/**
 * Build a PhaseRegistry populated from PHASE_MANIFEST in phase-ID order.
 */
export function buildRegistry(): PhaseRegistry {
  const registry = new PhaseRegistry();
  for (const entry of PHASE_MANIFEST) {
    registry.register(entry.executorFactory());
  }
  return registry;
}

/**
 * Build a gate map from PHASE_MANIFEST, keyed by phase ID.
 * Equivalent to the hardcoded GATE_MAP in issue-orchestrator.ts.
 */
export function buildGateMap(): Record<number, PhaseGate> {
  const map: Record<number, PhaseGate> = {};
  for (const entry of PHASE_MANIFEST) {
    if (entry.gate !== null) {
      map[entry.phaseId] = entry.gate;
    }
  }
  return map;
}
