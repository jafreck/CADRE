/**
 * Phase definitions and ordering for CADRE's per-issue pipeline.
 *
 * Generic types and helpers are provided by @cadre-dev/framework/engine;
 * this module re-exports them alongside Cadre-specific constants.
 */

import {
  PhaseRegistry,
  getPhaseSubset as _getPhaseSubset,
  getPhase as _getPhase,
  getPhaseCount as _getPhaseCount,
  isLastPhase as _isLastPhase,
  buildRegistry as _buildRegistry,
  buildGateMap as _buildGateMap,
  type PhaseDefinition,
  type PhaseManifestEntry,
} from '@cadre-dev/framework/engine';

import type { GatePlugin, PhaseGate } from '@cadre-dev/framework/engine';
import { listGatePlugins } from '@cadre-dev/framework/engine';
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

export type { PhaseDefinition, PhaseManifestEntry };
export { PhaseRegistry };

/** Single source of truth for all pipeline phase metadata. */
export const PHASE_MANIFEST: readonly PhaseManifestEntry[] = [
  {
    id: 1,
    name: 'Analysis & Scouting',
    executorFactory: () => new AnalysisPhaseExecutor(),
    gate: new AnalysisToPlanningGate(),
    critical: true,
    commitType: 'chore',
    commitMessage: 'analyze issue #{issueNumber}',
    includeInReviewResponse: false,
  },
  {
    id: 2,
    name: 'Planning',
    executorFactory: () => new PlanningPhaseExecutor(),
    gate: new PlanningToImplementationGate(),
    critical: true,
    commitType: 'chore',
    commitMessage: 'plan implementation for #{issueNumber}',
    includeInReviewResponse: false,
  },
  {
    id: 3,
    name: 'Implementation',
    executorFactory: () => new ImplementationPhaseExecutor(),
    gate: new ImplementationToIntegrationGate(),
    critical: true,
    commitType: 'feat',
    commitMessage: 'implement changes for #{issueNumber}',
    includeInReviewResponse: true,
  },
  {
    id: 4,
    name: 'Integration Verification',
    executorFactory: () => new IntegrationPhaseExecutor(),
    gate: new IntegrationToPRGate(),
    critical: true,
    commitType: 'fix',
    commitMessage: 'address integration issues',
    includeInReviewResponse: true,
  },
  {
    id: 5,
    name: 'PR Composition',
    executorFactory: () => new PRCompositionPhaseExecutor(),
    gate: null,
    critical: true,
    commitType: 'chore',
    commitMessage: 'compose PR for #{issueNumber}',
    includeInReviewResponse: true,
  },
];

/**
 * Get a subset of phase definitions by ID, returned in phase-ID order.
 */
export function getPhaseSubset(ids: number[]): PhaseDefinition[] {
  return _getPhaseSubset(PHASE_MANIFEST, ids);
}

/**
 * Get a phase definition by ID.
 */
export function getPhase(phaseId: number): PhaseDefinition | undefined {
  return _getPhase(PHASE_MANIFEST, phaseId);
}

/**
 * Get the total number of phases in the pipeline.
 */
export function getPhaseCount(): number {
  return _getPhaseCount(PHASE_MANIFEST);
}

/**
 * Check if a phase is the last one.
 */
export function isLastPhase(phaseId: number): boolean {
  return _isLastPhase(PHASE_MANIFEST, phaseId);
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
export function buildGateMap(plugins?: readonly GatePlugin[]): Record<number, PhaseGate> {
  return _buildGateMap(PHASE_MANIFEST, plugins ?? listGatePlugins());
}
