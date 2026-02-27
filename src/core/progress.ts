/**
 * Progress writers for CADRE pipelines.
 *
 * All progress types and classes are provided by @cadre/pipeline-engine.
 * This module re-exports them for backward compatibility.
 */

export {
  phaseNames,
  FleetProgressWriter,
  IssueProgressWriter,
} from '@cadre/pipeline-engine';

export type {
  PullRequestRef,
  IssueProgressInfo,
} from '@cadre/pipeline-engine';
