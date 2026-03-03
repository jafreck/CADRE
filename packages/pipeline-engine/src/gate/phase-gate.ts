/**
 * Phase gate interfaces for inter-phase quality validation.
 */

import type { GateResult } from '../types.js';

/** Context passed to every gate validator. */
export interface GateContext {
  /** Directory containing phase artifacts (analysis.md, scout-report.md, etc.). */
  artifactsDir: string;
  /** Root path of the active workspace. */
  workspacePath: string;
  /** Optional baseline revision used to compute diffs in implementation/integration gates. */
  baselineRef?: string;
  /** @deprecated Use artifactsDir. */
  progressDir?: string;
  /** @deprecated Use workspacePath. */
  worktreePath?: string;
  /** @deprecated Use baselineRef. */
  baseCommit?: string;
}

/** A quality gate that runs before transitioning between pipeline phases. */
export interface PhaseGate {
  validate(context: GateContext): Promise<GateResult>;
}
