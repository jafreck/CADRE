/**
 * Checkpoint management for CADRE pipelines.
 *
 * All checkpoint types and classes are provided by @cadre/pipeline-engine.
 * This module re-exports them for backward compatibility.
 */

export {
  CheckpointManager,
  FleetCheckpointManager,
  FileSystemCheckpointStore,
} from '@cadre/framework/engine';

export type {
  FailedTask,
  CheckpointState,
  FleetIssueStatus,
  FleetCheckpointState,
  CheckpointStore,
} from '@cadre/framework/engine';
