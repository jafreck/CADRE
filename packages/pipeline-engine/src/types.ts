/**
 * Shared type definitions for the pipeline engine.
 */

/** Minimal logger interface for engine consumers. */
export interface Logger {
  info(message: string, context?: Record<string, unknown>): void;
  warn(message: string, context?: Record<string, unknown>): void;
  error(message: string, context?: Record<string, unknown>): void;
  debug(message: string, context?: Record<string, unknown>): void;
}

/** Result of a quality-gate validation. */
export interface GateResult {
  status: 'pass' | 'warn' | 'fail';
  warnings: string[];
  errors: string[];
}

/** Detailed token-usage record for a single agent invocation. */
export interface TokenRecord {
  issueNumber: number;
  agent: string;
  phase: number;
  tokens: number;
  timestamp: string;
  input?: number;
  output?: number;
}

/** Result of a single pipeline phase. */
export interface PhaseResult {
  phase: number;
  phaseName: string;
  success: boolean;
  duration: number;
  tokenUsage: unknown;
  outputPath?: string;
  error?: string;
  gateResult?: GateResult;
}

/** Comment on an issue or work item. */
export interface IssueComment {
  author: string;
  body: string;
  createdAt: string;
}

/** Normalized representation of an issue or work item across platforms. */
export interface IssueDetail {
  number: number;
  title: string;
  body: string;
  labels: string[];
  assignees: string[];
  milestone?: string;
  comments: IssueComment[];
  state: 'open' | 'closed';
  createdAt: string;
  updatedAt: string;
  linkedPRs: number[];
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
