/**
 * Shared type definitions for the pipeline engine.
 */

// Re-export shared generic runtime types from agent-runtime
export type {
  GateResult,
  PhaseResult,
} from '../runtime/context/types.js';
export type { TokenRecord } from '../runtime/budget/token-tracker.js';

/** Comment on a work item. */
export interface WorkItemComment {
  author: string;
  body: string;
  createdAt: string;
}

/**
 * Normalized representation of a schedulable work item.
 *
 * Framework packages should depend on this generic shape rather than
 * CADRE-specific issue provider types.
 */
export interface WorkItem {
  number: number;
  title: string;
  body: string;
  labels: string[];
  assignees: string[];
  milestone?: string;
  comments: WorkItemComment[];
  state: 'open' | 'closed';
  createdAt: string;
  updatedAt: string;
  linkedPRs: number[];
}

/** A strongly-connected component produced by graph condensation. */
export interface CondensedWorkItemComponent<TWorkItem extends WorkItem = WorkItem> {
  /** Stable component id derived from the sorted work item numbers. */
  id: string;
  /** Sorted work item numbers contained in this component. */
  itemNumbers: number[];
  /** Original work items contained in this component. */
  items: TWorkItem[];
  /** True when the component represents a cycle or self-loop. */
  isCycle: boolean;
}

/** Result of condensing an arbitrary directed work-item graph into a DAG. */
export interface CondensedWorkItemGraph<TWorkItem extends WorkItem = WorkItem> {
  /** All condensed components, one per SCC, in stable order. */
  components: CondensedWorkItemComponent<TWorkItem>[];
  /** DAG dependency map between component ids. */
  depMap: Record<string, string[]>;
  /** Lookup from work item number to its containing component id. */
  itemToComponentId: Record<number, string>;
}

/** Minimal logger interface for engine consumers. */
export interface Logger {
  info(message: string, context?: Record<string, unknown>): void;
  warn(message: string, context?: Record<string, unknown>): void;
  error(message: string, context?: Record<string, unknown>): void;
  debug(message: string, context?: Record<string, unknown>): void;
}

/** Error thrown when the issue dependency graph contains a cycle. */
export class CyclicDependencyError extends Error {
  issueNumbers: number[];

  constructor(message: string, issueNumbers: number[]) {
    super(message);
    this.name = 'CyclicDependencyError';
    this.issueNumbers = issueNumbers;
  }
}
