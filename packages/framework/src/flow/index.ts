// @cadre/framework/flow — declarative flow graph DSL and runner

export {
  defineFlow,
  step,
  gate,
  conditional,
  loop,
  parallel,
} from './dsl.js';

export { fromStep, fromSteps, fromContext } from './refs.js';
export { FlowRunner } from './runner.js';
export { validateFlowContracts } from './contracts.js';

export type {
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
  FlowDefinition,
  FlowExecutionContext,
  FlowRunResult,
  FlowRunnerOptions,
  FlowCheckpointAdapter,
  FlowCheckpointSnapshot,
} from './types.js';

export { FlowExecutionError, FlowCycleError, FlowContractError } from './types.js';
