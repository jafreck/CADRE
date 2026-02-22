/**
 * Phase definitions and ordering for CADRE's per-issue pipeline.
 */

export interface PhaseDefinition {
  /** Phase number (1-based). */
  id: number;
  /** Human-readable phase name. */
  name: string;
  /** Whether failure in this phase should abort the issue pipeline. */
  critical: boolean;
}

export const ISSUE_PHASES: PhaseDefinition[] = [
  { id: 1, name: 'Analysis & Scouting', critical: true },
  { id: 2, name: 'Planning', critical: true },
  { id: 3, name: 'Implementation', critical: true },
  { id: 4, name: 'Integration Verification', critical: false },
  { id: 5, name: 'PR Composition', critical: false },
];

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
