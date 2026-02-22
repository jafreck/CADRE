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
