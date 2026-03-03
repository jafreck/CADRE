// @cadre/framework — root barrel re-exports all subpaths
// Note: Logger from core (class) and engine (interface) conflict.
// The root barrel exports core's Logger class; engine's Logger is available
// via @cadre/framework/engine.

export * from './core/index.js';
export * from './runtime/index.js';
export {
  // Re-export everything from engine EXCEPT Logger to avoid conflict with core
  CyclicDependencyError,
  type GateResult,
  type TokenRecord,
  type PhaseResult,
  type WorkItemComment,
  type WorkItem,
  type PhaseDefinition,
  type PhaseManifestEntry,
  PhaseRegistry,
  getPhaseSubset,
  getPhase,
  getPhaseCount,
  isLastPhase,
  buildRegistry,
  buildGateMap,
  type PhaseExecutor,
  type PhaseContext,
  type PhaseServices,
  type PhaseIO,
  type PhaseCallbacks,
  type PhaseGate,
  type GateContext,
  type GatePlugin,
  registerGatePlugin,
  unregisterGatePlugin,
  clearGatePlugins,
  listGatePlugins,
  type FailedTask,
  type CheckpointState,
  type FleetIssueStatus,
  type FleetCheckpointState,
  type CheckpointStore,
  CheckpointManager,
  FleetCheckpointManager,
  FileSystemCheckpointStore,
  WorkItemDag,
  IssueDag,
  type PullRequestRef,
  type IssueProgressInfo,
  phaseNames,
  FleetProgressWriter,
  IssueProgressWriter,
  ParallelExecutor,
  SerialExecutor,
  type AgentLauncherLike,
  SessionQueue,
  TaskQueue,
  RetryExecutor,
  type RetryOptions,
  type RetryResult,
  type LoggerLike,
} from './engine/index.js';
export * from './flow/index.js';
export * from './notifications/index.js';
