// @cadre/pipeline-engine entry point

// Shared types
export type {
  Logger,
  GateResult,
  TokenRecord,
  PhaseResult,
  IssueComment,
  IssueDetail,
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
export type { PhaseGate, GateContext } from './gate/phase-gate.js';

// Checkpoint
export type {
  FailedTask,
  CheckpointState,
  FleetIssueStatus,
  FleetCheckpointState,
} from './checkpoint/checkpoint.js';
export { CheckpointManager, FleetCheckpointManager } from './checkpoint/checkpoint.js';

// Scheduler
export { IssueDag } from './scheduler/issue-dag.js';

// Progress
export type { PullRequestRef, IssueProgressInfo } from './progress/progress.js';
export {
  phaseNames,
  FleetProgressWriter,
  IssueProgressWriter,
} from './progress/progress.js';
