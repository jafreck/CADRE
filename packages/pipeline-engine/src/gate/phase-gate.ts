/**
 * Phase gate interfaces for inter-phase quality validation.
 */

import type { GateResult } from '../types.js';

/** Context passed to every gate validator. */
export interface GateContext {
  /** Directory containing agent output files (analysis.md, scout-report.md, etc.). */
  progressDir: string;
  /** Root path of the worktree. */
  worktreePath: string;
  /** Base commit SHA used to compute diff in implementation-to-integration gates. */
  baseCommit?: string;
}

/** A quality gate that runs before transitioning between pipeline phases. */
export interface PhaseGate {
  validate(context: GateContext): Promise<GateResult>;
}
