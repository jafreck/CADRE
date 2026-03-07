/**
 * Typed event definitions for CADRE's structured logging system.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  source: string;
  issueNumber?: number;
  phase?: number;
  taskId?: string;
  message: string;
  data?: Record<string, unknown>;
}

export interface RunStartedEvent {
  type: 'fleet-started';
  issueCount: number;
  maxParallel: number;
}

export interface RunCompletedEvent {
  type: 'fleet-completed';
  success: boolean;
  prsCreated: number;
  failedIssues: number;
  totalDuration: number;
  totalTokens: number;
}

export interface RunInterruptedEvent {
  type: 'fleet-interrupted';
  signal: string;
  issuesInProgress: number[];
}

export interface WorkUnitStartedEvent {
  type: 'issue-started';
  issueNumber: number;
  issueTitle: string;
  worktreePath: string;
}

export interface WorkUnitCompletedEvent {
  type: 'issue-completed';
  issueNumber: number;
  issueTitle: string;
  success: boolean;
  prNumber?: number;
  prUrl?: string;
  duration: number;
  tokenUsage: number;
}

export interface WorkUnitFailedEvent {
  type: 'issue-failed';
  issueNumber: number;
  issueTitle: string;
  error: string;
  phase: number;
  phaseName?: string;
  failedTask?: string;
}

export interface StageStartedEvent {
  type: 'phase-started';
  issueNumber: number;
  phase: number;
  phaseName: string;
}

export interface StageCompletedEvent {
  type: 'phase-completed';
  issueNumber: number;
  phase: number;
  phaseName: string;
  duration: number;
}

export interface StageSkippedEvent {
  type: 'phase-skipped';
  issueNumber: number;
  phase: number;
  reason: string;
}

export interface AgentLaunchedEvent {
  type: 'agent-launched';
  agent: string;
  issueNumber: number;
  taskId?: string;
  worktreePath: string;
}

export interface AgentCompletedEvent {
  type: 'agent-completed';
  agent: string;
  issueNumber: number;
  taskId?: string;
  exitCode: number;
  duration: number;
  tokenUsage: number;
}

export interface AgentFailedEvent {
  type: 'agent-failed';
  agent: string;
  issueNumber: number;
  taskId?: string;
  error: string;
  timedOut: boolean;
}

export interface AgentOutputEvent {
  type: 'agent-output';
  issueNumber: number;
  agent: string;
  chunk: string;
  stream: 'stdout' | 'stderr';
}

export interface WorkStepStartedEvent {
  type: 'task-started';
  issueNumber: number;
  taskId: string;
  taskName: string;
}

export interface WorkStepCompletedEvent {
  type: 'task-completed';
  issueNumber: number;
  taskId: string;
  duration: number;
}

export interface WorkStepBlockedEvent {
  type: 'task-blocked';
  issueNumber: number;
  taskId: string;
  reason: string;
  retryCount: number;
}

export interface WorkStepRetryEvent {
  type: 'task-retry';
  issueNumber: number;
  taskId: string;
  attempt: number;
  maxAttempts: number;
  reason: string;
}

export interface GitCommitEvent {
  type: 'git-commit';
  issueNumber: number;
  sha: string;
  message: string;
}

export interface GitPushEvent {
  type: 'git-push';
  issueNumber: number;
  branch: string;
}

export interface PRCreatedEvent {
  type: 'pr-created';
  issueNumber: number;
  prNumber: number;
  prUrl: string;
}

export interface IsolationSessionStartedEvent {
  type: 'isolation-session-started';
  providerName: string;
  sessionId: string;
  policyProfile: string;
}

export interface IsolationSessionEndedEvent {
  type: 'isolation-session-ended';
  providerName: string;
  sessionId: string;
  durationMs: number;
  success: boolean;
}

export interface IsolationCapabilityDowngradeEvent {
  type: 'isolation-capability-downgrade';
  requestedProvider: string;
  fallbackProvider: string;
  reason: string;
}

export interface AmbiguityDetectedEvent {
  type: 'ambiguity-detected';
  issueNumber: number;
  ambiguities: string[];
}

export interface BudgetWarningEvent {
  type: 'budget-warning';
  scope: 'fleet' | 'issue';
  issueNumber?: number;
  currentUsage: number;
  budget: number;
  percentUsed: number;
}

export interface BudgetExceededEvent {
  type: 'budget-exceeded';
  scope: 'fleet' | 'issue';
  issueNumber?: number;
  currentUsage: number;
  budget: number;
}

export type RunLifecycleEvent =
  | RunStartedEvent
  | RunCompletedEvent
  | RunInterruptedEvent;

export type WorkUnitLifecycleEvent =
  | WorkUnitStartedEvent
  | WorkUnitCompletedEvent
  | WorkUnitFailedEvent;

export type StageLifecycleEvent =
  | StageStartedEvent
  | StageCompletedEvent
  | StageSkippedEvent;

export type WorkStepLifecycleEvent =
  | WorkStepStartedEvent
  | WorkStepCompletedEvent
  | WorkStepBlockedEvent
  | WorkStepRetryEvent;

export type FrameworkLifecycleEvent =
  | RunLifecycleEvent
  | WorkUnitLifecycleEvent
  | StageLifecycleEvent
  | WorkStepLifecycleEvent
  | AgentLaunchedEvent
  | AgentCompletedEvent
  | AgentFailedEvent
  | AgentOutputEvent
  | IsolationSessionStartedEvent
  | IsolationSessionEndedEvent
  | IsolationCapabilityDowngradeEvent;

export type CadreSemanticEvent =
  | GitCommitEvent
  | GitPushEvent
  | PRCreatedEvent
  | AmbiguityDetectedEvent;

export type BudgetEvent =
  | BudgetWarningEvent
  | BudgetExceededEvent;

export type FrameworkBoundaryEvent =
  | FrameworkLifecycleEvent
  | BudgetEvent;

export type RuntimeEvent =
  | FrameworkBoundaryEvent
  | CadreSemanticEvent;

/**
 * @deprecated Use `RuntimeEvent` or one of the stratified unions.
 */
export type CadreEvent = RuntimeEvent;

/**
 * @deprecated Use `RunStartedEvent`.
 */
export type FleetStartedEvent = RunStartedEvent;
/**
 * @deprecated Use `RunCompletedEvent`.
 */
export type FleetCompletedEvent = RunCompletedEvent;
/**
 * @deprecated Use `RunInterruptedEvent`.
 */
export type FleetInterruptedEvent = RunInterruptedEvent;

/**
 * @deprecated Use `WorkUnitStartedEvent`.
 */
export type IssueStartedEvent = WorkUnitStartedEvent;
/**
 * @deprecated Use `WorkUnitCompletedEvent`.
 */
export type IssueCompletedEvent = WorkUnitCompletedEvent;
/**
 * @deprecated Use `WorkUnitFailedEvent`.
 */
export type IssueFailedEvent = WorkUnitFailedEvent;

/**
 * @deprecated Use `StageStartedEvent`.
 */
export type PhaseStartedEvent = StageStartedEvent;
/**
 * @deprecated Use `StageCompletedEvent`.
 */
export type PhaseCompletedEvent = StageCompletedEvent;
/**
 * @deprecated Use `StageSkippedEvent`.
 */
export type PhaseSkippedEvent = StageSkippedEvent;

/**
 * @deprecated Use `WorkStepStartedEvent`.
 */
export type TaskStartedEvent = WorkStepStartedEvent;
/**
 * @deprecated Use `WorkStepCompletedEvent`.
 */
export type TaskCompletedEvent = WorkStepCompletedEvent;
/**
 * @deprecated Use `WorkStepBlockedEvent`.
 */
export type TaskBlockedEvent = WorkStepBlockedEvent;
/**
 * @deprecated Use `WorkStepRetryEvent`.
 */
export type TaskRetryEvent = WorkStepRetryEvent;

/**
 * @deprecated Use `RunLifecycleEvent`.
 */
export type FleetLifecycleEvent = RunLifecycleEvent;
/**
 * @deprecated Use `WorkUnitLifecycleEvent`.
 */
export type CadreIssueLifecycleEvent = WorkUnitLifecycleEvent;
/**
 * @deprecated Use `StageLifecycleEvent`.
 */
export type CadrePhaseLifecycleEvent = StageLifecycleEvent;
/**
 * @deprecated Use `WorkStepLifecycleEvent`.
 */
export type CadreTaskLifecycleEvent = WorkStepLifecycleEvent;

export type CadreDomainEvent =
  | WorkUnitLifecycleEvent
  | StageLifecycleEvent
  | WorkStepLifecycleEvent
  | CadreSemanticEvent
  | BudgetEvent;
