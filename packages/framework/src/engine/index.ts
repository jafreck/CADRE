// @cadre-dev/framework/engine — pipeline engine + execution primitives

// === From pipeline-engine ===

// Shared types
export type {
  Logger,
  GateResult,
  TokenRecord,
  PhaseResult,
  WorkItemComment,
  WorkItem,
  CondensedWorkItemComponent,
  CondensedWorkItemGraph,
} from './types.js';
export { CyclicDependencyError } from './types.js';

// Phase registry
export type { PhaseDefinition, PhaseManifestEntry } from './phase/registry.js';
export {
  PhaseRegistry,
  getPhaseSubset,
  getPhase,
  getPhaseCount,
  isLastPhase,
  buildRegistry,
  buildGateMap,
} from './phase/registry.js';

// Phase executor
export type {
  PhaseExecutor,
  PhaseContext,
  PhaseServices,
  PhaseIO,
  PhaseCallbacks,
} from './executor/phase-executor.js';

// Phase gate
export type { PhaseGate, GateContext, GatePlugin } from './gate/phase-gate.js';
export {
  registerGatePlugin,
  unregisterGatePlugin,
  clearGatePlugins,
  listGatePlugins,
} from './gate/phase-gate.js';

// Checkpoint
export type {
  FailedTask,
  CheckpointState,
  FleetIssueStatus,
  FleetCheckpointState,
  CheckpointStore,
} from './checkpoint/checkpoint.js';
export {
  CheckpointManager,
  FleetCheckpointManager,
  FileSystemCheckpointStore,
} from './checkpoint/checkpoint.js';

// Scheduler
export { WorkItemDag } from './scheduler/issue-dag.js';
export { condenseWorkItemGraph } from './scheduler/graph-condensation.js';

// Progress
export type { PullRequestRef, IssueProgressInfo } from './progress/progress.js';
export {
  phaseNames,
  FleetProgressWriter,
  IssueProgressWriter,
} from './progress/progress.js';

// === From execution ===
export { ParallelExecutor } from './executors/parallel-executor.js';
export { SerialExecutor, type AgentLauncherLike } from './executors/serial-executor.js';
export { SessionQueue, TaskQueue, type TaskLike } from './executors/task-queue.js';
export { RetryExecutor, type RetryOptions, type RetryResult, type LoggerLike } from './executors/retry.js';
