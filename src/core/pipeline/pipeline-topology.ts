/**
 * Declarative pipeline topology for the per-issue flow.
 *
 * Each phase is spelled out explicitly using DSL primitives (`gatedStep`,
 * `step`, `gate`, `sequence`) so the shape of the pipeline is immediately
 * readable.  Phases whose executor is absent (e.g. dry-run) are omitted;
 * `dependsOn` is wired automatically between surviving phases.
 */

import type { PhaseResult } from '../../agents/types.js';
import type { PhaseExecutor, PhaseContext } from './phase-executor.js';
import type { GateCoordinator } from './gate-coordinator.js';
import { step, gate, sequence, gatedStep } from '@cadre-dev/framework/flow';
import type { FlowNode } from '@cadre-dev/framework/flow';
import type { PipelineFlowContext, PhaseActions } from './phase-action-callbacks.js';

export interface PipelineTopologyOpts {
  executorMap: Map<number, PhaseExecutor>;
  actions: PhaseActions;
  gateCoordinator: GateCoordinator;
  phaseCtx: PhaseContext;
  executePhase: (e: PhaseExecutor) => Promise<PhaseResult>;
  maxGateRetries: number;
}

/**
 * Build the pipeline flow graph.
 *
 * The topology is declared inline so the pipeline shape is immediately
 * visible — no indirection through manifest iteration.
 *
 *   phase-1  Analysis & Scouting   gatedStep → ambiguity-check → finalize
 *   phase-2  Planning              gatedStep → finalize
 *   phase-3  Implementation        gatedStep → finalize
 *   phase-4  Integration           gatedStep → finalize
 *   phase-5  PR Composition        step      → finalize
 */
export function buildPipelineTopology(opts: PipelineTopologyOpts): FlowNode<PipelineFlowContext>[] {
  const { executorMap, actions, gateCoordinator, phaseCtx, executePhase, maxGateRetries } = opts;

  // ── shorthand closures for readability ──────────────────────────────
  const e = (id: number) => executorMap.get(id);
  const gated = (id: number) => actions.gated(e(id)!, phaseCtx, gateCoordinator, executePhase);
  const ungated = (id: number) => actions.ungated(e(id)!, phaseCtx, executePhase);
  const fin = (id: number) => actions.finalize(e(id)!);

  // ── Declarative pipeline ────────────────────────────────────────────
  const phases: (FlowNode<PipelineFlowContext> | null)[] = [
    // Phase 1 — Analysis & Scouting (gated + ambiguity check)
    e(1) ? sequence<PipelineFlowContext>(
      { id: 'phase-1', name: 'Analysis & Scouting' },
      [
        gatedStep({ id: 'execute', name: 'Analysis & Scouting', maxRetries: maxGateRetries, ...gated(1) }),
        gate({ id: 'ambiguity-check', name: 'Check for ambiguities', evaluate: actions.checkAmbiguities(gateCoordinator) }),
        step({ id: 'finalize', name: 'Commit & cleanup', run: fin(1) }),
      ],
    ) : null,

    // Phase 2 — Planning (gated)
    e(2) ? sequence<PipelineFlowContext>(
      { id: 'phase-2', name: 'Planning' },
      [
        gatedStep({ id: 'execute', name: 'Planning', maxRetries: maxGateRetries, ...gated(2) }),
        step({ id: 'finalize', name: 'Commit & cleanup', run: fin(2) }),
      ],
    ) : null,

    // Phase 3 — Implementation (gated)
    e(3) ? sequence<PipelineFlowContext>(
      { id: 'phase-3', name: 'Implementation' },
      [
        gatedStep({ id: 'execute', name: 'Implementation', maxRetries: maxGateRetries, ...gated(3) }),
        step({ id: 'finalize', name: 'Commit & cleanup', run: fin(3) }),
      ],
    ) : null,

    // Phase 4 — Integration Verification (gated)
    e(4) ? sequence<PipelineFlowContext>(
      { id: 'phase-4', name: 'Integration Verification' },
      [
        gatedStep({ id: 'execute', name: 'Integration Verification', maxRetries: maxGateRetries, ...gated(4) }),
        step({ id: 'finalize', name: 'Commit & cleanup', run: fin(4) }),
      ],
    ) : null,

    // Phase 5 — PR Composition (ungated)
    e(5) ? sequence<PipelineFlowContext>(
      { id: 'phase-5', name: 'PR Composition' },
      [
        step({ id: 'execute', name: 'PR Composition', run: ungated(5) }),
        step({ id: 'finalize', name: 'Commit & cleanup', run: fin(5) }),
      ],
    ) : null,
  ];

  return chainDependencies(phases.filter((n): n is FlowNode<PipelineFlowContext> => n != null));
}

/** Wire sequential `dependsOn` — each node depends on the one before it. */
function chainDependencies<T>(nodes: FlowNode<T>[]): FlowNode<T>[] {
  for (let i = 1; i < nodes.length; i++) {
    (nodes[i] as FlowNode<T> & { dependsOn?: string[] }).dependsOn = [nodes[i - 1].id];
  }
  return nodes;
}
