/**
 * Shared type definitions for the pipeline engine.
 */

// Re-export shared types from agent-runtime (canonical home)
export type {
  GateResult,
  PhaseResult,
  TokenRecord,
  IssueComment,
  IssueDetail,
} from '@cadre/agent-runtime';

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
