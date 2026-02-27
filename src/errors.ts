export class BudgetExceededError extends Error {
  current: number;
  budget: number;

  constructor(message: string, current: number, budget: number) {
    super(message);
    this.name = 'BudgetExceededError';
    this.current = current;
    this.budget = budget;
  }
}

export class PhaseFailedError extends Error {
  phase: number;
  phaseName: string;

  constructor(message: string, phase: number, phaseName: string) {
    super(message);
    this.name = 'PhaseFailedError';
    this.phase = phase;
    this.phaseName = phaseName;
  }
}

export class AgentTimeoutError extends Error {
  agent: string;
  timeoutMs: number;

  constructor(message: string, agent: string, timeoutMs: number) {
    super(message);
    this.name = 'AgentTimeoutError';
    this.agent = agent;
    this.timeoutMs = timeoutMs;
  }
}

export class SchemaValidationError extends Error {
  field: string;
  received: unknown;

  constructor(message: string, field: string, received: unknown) {
    super(message);
    this.name = 'SchemaValidationError';
    this.field = field;
    this.received = received;
  }
}

export { CyclicDependencyError } from '../packages/pipeline-engine/src/index.js';

export class DependencyResolutionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DependencyResolutionError';
  }
}

export class DependencyMergeConflictError extends Error {
  issueNumber: number;
  conflictingBranch: string;

  constructor(message: string, issueNumber: number, conflictingBranch: string) {
    super(message);
    this.name = 'DependencyMergeConflictError';
    this.issueNumber = issueNumber;
    this.conflictingBranch = conflictingBranch;
  }
}

export class StaleStateError extends Error {
  result: import('./validation/stale-state-validator.js').StaleStateResult;

  constructor(message: string, result: import('./validation/stale-state-validator.js').StaleStateResult) {
    super(message);
    this.name = 'StaleStateError';
    this.result = result;
  }
}

export class AuthenticationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AuthenticationError';
  }
}

export class ValidationFailedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationFailedError';
  }
}

export class RuntimeInterruptedError extends Error {
  signal: string;
  exitCode: number;

  constructor(message: string, signal: string, exitCode: number) {
    super(message);
    this.name = 'RuntimeInterruptedError';
    this.signal = signal;
    this.exitCode = exitCode;
  }
}
