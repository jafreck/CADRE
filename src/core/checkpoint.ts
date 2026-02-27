/**
 * Checkpoint management for CADRE pipelines.
 *
 * All checkpoint types and classes are provided by @cadre/pipeline-engine.
 * This module re-exports them for backward compatibility.
 */

export {
  CheckpointManager,
  FleetCheckpointManager,
} from '../../packages/pipeline-engine/src/index.js';

export type {
  FailedTask,
  CheckpointState,
  FleetIssueStatus,
  FleetCheckpointState,
} from '../../packages/pipeline-engine/src/index.js';
