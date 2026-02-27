/**
 * Phase definitions and ordering for CADRE's per-issue pipeline.
 *
 * Generic types and helpers are provided by @cadre/pipeline-engine;
 * this module re-exports them alongside Cadre-specific constants.
 */

export type { PhaseDefinition, PhaseManifestEntry } from '../../packages/pipeline-engine/src/index.js';
export { PhaseRegistry } from '../../packages/pipeline-engine/src/index.js';

import type { PhaseDefinition, PhaseManifestEntry } from '../../packages/pipeline-engine/src/index.js';
import {
  PhaseRegistry,
  getPhaseSubset as _getPhaseSubset,
  getPhase as _getPhase,
  getPhaseCount as _getPhaseCount,
  isLastPhase as _isLastPhase,
  buildRegistry as _buildRegistry,
  buildGateMap as _buildGateMap,
} from '../../packages/pipeline-engine/src/index.js';

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

export const ISSUE_PHASES: PhaseDefinition[] = [
  { id: 1, name: 'Analysis & Scouting', critical: true, commitType: 'chore', commitMessage: 'analyze issue #{issueNumber}' },
  { id: 2, name: 'Planning', critical: true, commitType: 'chore', commitMessage: 'plan implementation for #{issueNumber}' },
  { id: 3, name: 'Implementation', critical: true, commitType: 'feat', commitMessage: 'implement changes for #{issueNumber}' },
  { id: 4, name: 'Integration Verification', critical: true, commitType: 'fix', commitMessage: 'address integration issues' },
  { id: 5, name: 'PR Composition', critical: true, commitType: 'chore', commitMessage: 'compose PR for #{issueNumber}' },
];

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
  return _getPhaseSubset(ISSUE_PHASES, ids);
}

/**
 * Get a phase definition by ID.
 */
export function getPhase(phaseId: number): PhaseDefinition | undefined {
  return _getPhase(ISSUE_PHASES, phaseId);
}

/**
 * Get the total number of phases in the pipeline.
 */
export function getPhaseCount(): number {
  return _getPhaseCount(ISSUE_PHASES);
}

/**
 * Check if a phase is the last one.
 */
export function isLastPhase(phaseId: number): boolean {
  return _isLastPhase(ISSUE_PHASES, phaseId);
}

/**
 * Build a PhaseRegistry populated from PHASE_MANIFEST in phase-ID order.
 */
export function buildRegistry(): PhaseRegistry {
  return _buildRegistry(PHASE_MANIFEST);
}

/**
 * Build a gate map from PHASE_MANIFEST, keyed by phase ID.
 */
export function buildGateMap(): Record<number, PhaseGate> {
  return _buildGateMap(PHASE_MANIFEST);
}
