/**
 * Bridge between the flow/ DSL and engine/ pipeline systems.
 *
 * Provides utilities to:
 * - Wrap PhaseExecutors as flow steps
 * - Build a FlowDefinition from a PhaseManifestEntry array
 * - Wrap PhaseGates as flow gates
 */

import type { PhaseExecutor, PhaseContext } from '../engine/executor/phase-executor.js';
import type { PhaseManifestEntry } from '../engine/phase/registry.js';
import type { PhaseGate, GateContext } from '../engine/gate/phase-gate.js';
import type { FlowDefinition, FlowNode, FlowStepNode, FlowGateNode, FlowExecutionContext } from './types.js';

/**
 * Adapter context that flow steps receive.  The flow's TContext must carry
 * the PhaseContext so the adapter can delegate to the real executor.
 */
export interface FlowPhaseContext<TCtx extends PhaseContext = PhaseContext> {
  /** The engine PhaseContext, injected into the flow context. */
  phaseContext: TCtx;
  /** Gate context for inter-phase validation. */
  gateContext?: GateContext;
}

/**
 * Wrap a PhaseExecutor as a flow step node.
 *
 * The flow context's `context` must conform to `FlowPhaseContext<TCtx>`.
 */
export function phaseExecutorAsStep<TCtx extends PhaseContext = PhaseContext>(
  executor: PhaseExecutor<TCtx>,
  options?: { dependsOn?: string[] },
): FlowStepNode<FlowPhaseContext<TCtx>, unknown, string> {
  return {
    kind: 'step',
    id: `phase-${executor.id}`,
    name: executor.name,
    dependsOn: options?.dependsOn,
    run: async (ctx: FlowExecutionContext<FlowPhaseContext<TCtx>>) => {
      return executor.execute(ctx.context.phaseContext);
    },
  };
}

/**
 * Wrap a PhaseGate as a flow gate node.
 */
export function phaseGateAsFlowGate<TCtx extends PhaseContext = PhaseContext>(
  phaseId: number,
  gate: PhaseGate,
  options?: { dependsOn?: string[] },
): FlowGateNode<FlowPhaseContext<TCtx>> {
  return {
    kind: 'gate',
    id: `gate-${phaseId}`,
    name: `Gate for phase ${phaseId}`,
    dependsOn: options?.dependsOn,
    evaluate: async (ctx: FlowExecutionContext<FlowPhaseContext<TCtx>>) => {
      const gateCtx = ctx.context.gateContext;
      if (!gateCtx) {
        throw new Error(`Gate context not provided in flow context for phase ${phaseId}`);
      }
      const result = await gate.validate(gateCtx);
      return result.status !== 'fail';
    },
  };
}

/**
 * Build a FlowDefinition from a phase manifest, with optional gates.
 *
 * Each phase becomes a step node. Each gate (if present) becomes a gate node
 * that depends on its phase step. Subsequent phases depend on the gate (or
 * the phase step if no gate).
 */
export function manifestToFlow<TCtx extends PhaseContext = PhaseContext>(
  flowId: string,
  manifest: readonly PhaseManifestEntry<TCtx>[],
  gateMap?: Record<number, PhaseGate>,
  description?: string,
): FlowDefinition<FlowPhaseContext<TCtx>> {
  const nodes: FlowNode<FlowPhaseContext<TCtx>>[] = [];
  let previousNodeId: string | undefined;

  for (const entry of manifest) {
    const executor = entry.executorFactory();
    const stepNode = phaseExecutorAsStep<TCtx>(executor, {
      dependsOn: previousNodeId ? [previousNodeId] : undefined,
    });
    nodes.push(stepNode);
    previousNodeId = stepNode.id;

    const gate = gateMap?.[entry.id] ?? entry.gate;
    if (gate) {
      const gateNode = phaseGateAsFlowGate<TCtx>(entry.id, gate, {
        dependsOn: [stepNode.id],
      });
      nodes.push(gateNode);
      previousNodeId = gateNode.id;
    }
  }

  return { id: flowId, description, nodes };
}
