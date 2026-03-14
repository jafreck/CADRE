/**
 * Typed event definitions for CADRE's structured logging system.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  source: string;
  workItemId?: string;
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
  workItemsInProgress: string[];
}

export interface WorkUnitStartedEvent {
  type: 'issue-started';
  workItemId: string;
  issueTitle: string;
  worktreePath: string;
}

export interface WorkUnitCompletedEvent {
  type: 'issue-completed';
  workItemId: string;
  issueTitle: string;
  success: boolean;
  prNumber?: number;
  prUrl?: string;
  duration: number;
  tokenUsage: number;
}

export interface WorkUnitFailedEvent {
  type: 'issue-failed';
  workItemId: string;
  issueTitle: string;
  error: string;
  phase: number;
  phaseName?: string;
  failedTask?: string;
}

export interface StageStartedEvent {
  type: 'phase-started';
  workItemId: string;
  phase: number;
  phaseName: string;
}

export interface StageCompletedEvent {
  type: 'phase-completed';
  workItemId: string;
  phase: number;
  phaseName: string;
  duration: number;
}

export interface StageSkippedEvent {
  type: 'phase-skipped';
  workItemId: string;
  phase: number;
  reason: string;
}

export interface AgentLaunchedEvent {
  type: 'agent-launched';
  agent: string;
  workItemId: string;
  taskId?: string;
  worktreePath: string;
}

export interface AgentCompletedEvent {
  type: 'agent-completed';
  agent: string;
  workItemId: string;
  taskId?: string;
  exitCode: number;
  duration: number;
  tokenUsage: number;
}

export interface AgentFailedEvent {
  type: 'agent-failed';
  agent: string;
  workItemId: string;
  taskId?: string;
  error: string;
  timedOut: boolean;
}

export interface WorkStepStartedEvent {
  type: 'task-started';
  workItemId: string;
  taskId: string;
  taskName: string;
}

export interface WorkStepCompletedEvent {
  type: 'task-completed';
  workItemId: string;
  taskId: string;
  duration: number;
}

export interface WorkStepBlockedEvent {
  type: 'task-blocked';
  workItemId: string;
  taskId: string;
  reason: string;
  retryCount: number;
}

export interface WorkStepRetryEvent {
  type: 'task-retry';
  workItemId: string;
  taskId: string;
  attempt: number;
  maxAttempts: number;
  reason: string;
}

export interface GitCommitEvent {
  type: 'git-commit';
  workItemId: string;
  sha: string;
  message: string;
}

export interface GitPushEvent {
  type: 'git-push';
  workItemId: string;
  branch: string;
}

export interface PRCreatedEvent {
  type: 'pr-created';
  workItemId: string;
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
  workItemId: string;
  ambiguities: string[];
}

export interface BudgetWarningEvent {
  type: 'budget-warning';
  scope: 'fleet' | 'issue';
  workItemId?: string;
  currentUsage: number;
  budget: number;
  percentUsed: number;
}

export interface BudgetExceededEvent {
  type: 'budget-exceeded';
  scope: 'fleet' | 'issue';
  workItemId?: string;
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



export type CadreDomainEvent =
  | WorkUnitLifecycleEvent
  | StageLifecycleEvent
  | WorkStepLifecycleEvent
  | CadreSemanticEvent
  | BudgetEvent;
