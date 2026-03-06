// @cadre-dev/framework/flow — declarative flow graph DSL and runner

export {
  defineFlow,
  step,
  gate,
  conditional,
  loop,
  parallel,
  sequence,
  gatedStep,
} from './dsl.js';

export type { GatedStepConfig } from './dsl.js';

export { fromStep, fromSteps, fromContext } from './refs.js';
export { FlowRunner } from './runner.js';
export { validateFlowContracts } from './contracts.js';

export type {
  MaybePromise,
  DataRef,
  FlowContracts,
  StepContract,
  FlowContractIssue,
  FlowContractValidationResult,
  FlowNode,
  FlowStepNode,
  FlowGateNode,
  FlowLoopNode,
  FlowParallelNode,
  FlowConditionalNode,
  FlowSequenceNode,
  FlowDefinition,
  FlowExecutionContext,
  FlowRunResult,
  FlowRunnerOptions,
  FlowCheckpointAdapter,
  FlowCheckpointSnapshot,
  FlowLifecycleHooks,
} from './types.js';

export { FlowExecutionError, FlowCycleError, FlowContractError } from './types.js';
