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
}

/** A quality gate that runs before transitioning between pipeline phases. */
export interface PhaseGate {
  validate(context: GateContext): Promise<GateResult>;
}

export interface GatePlugin {
  /** Optional plugin identifier used for inspection/removal. */
  name?: string;
  /** Phase ID this gate targets. */
  id: number;
  /** Gate instance to register for the target phase. */
  gate: PhaseGate;
  /** Optional priority for ordering. Higher priority runs first. Defaults to 0. */
  priority?: number;
}

const gatePlugins: GatePlugin[] = [];

export function registerGatePlugin(plugin: GatePlugin): void {
  gatePlugins.push(plugin);
  // Sort by priority descending (higher priority first)
  gatePlugins.sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));
}

export function unregisterGatePlugin(name: string): void {
  for (let index = gatePlugins.length - 1; index >= 0; index -= 1) {
    if (gatePlugins[index].name === name) {
      gatePlugins.splice(index, 1);
    }
  }
}

export function clearGatePlugins(): void {
  gatePlugins.length = 0;
}

export function listGatePlugins(): readonly GatePlugin[] {
  return gatePlugins;
}
