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

// ── Fleet-level events ──

export interface FleetStartedEvent {
  type: 'fleet-started';
  issueCount: number;
  maxParallel: number;
}

export interface FleetCompletedEvent {
  type: 'fleet-completed';
  success: boolean;
  prsCreated: number;
  failedIssues: number;
  totalDuration: number;
  totalTokens: number;
}

export interface FleetInterruptedEvent {
  type: 'fleet-interrupted';
  signal: string;
  issuesInProgress: number[];
}

// ── Issue-level events ──

export interface IssueStartedEvent {
  type: 'issue-started';
  issueNumber: number;
  issueTitle: string;
  worktreePath: string;
}

export interface IssueCompletedEvent {
  type: 'issue-completed';
  issueNumber: number;
  issueTitle: string;
  success: boolean;
  prNumber?: number;
  prUrl?: string;
  duration: number;
  tokenUsage: number;
}

export interface IssueFailedEvent {
  type: 'issue-failed';
  issueNumber: number;
  issueTitle: string;
  error: string;
  phase: number;
  phaseName?: string;
  failedTask?: string;
}

// ── Phase-level events ──

export interface PhaseStartedEvent {
  type: 'phase-started';
  issueNumber: number;
  phase: number;
  phaseName: string;
}

export interface PhaseCompletedEvent {
  type: 'phase-completed';
  issueNumber: number;
  phase: number;
  phaseName: string;
  duration: number;
}

export interface PhaseSkippedEvent {
  type: 'phase-skipped';
  issueNumber: number;
  phase: number;
  reason: string;
}

// ── Agent-level events ──

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

// ── Task-level events ──

export interface TaskStartedEvent {
  type: 'task-started';
  issueNumber: number;
  taskId: string;
  taskName: string;
}

export interface TaskCompletedEvent {
  type: 'task-completed';
  issueNumber: number;
  taskId: string;
  duration: number;
}

export interface TaskBlockedEvent {
  type: 'task-blocked';
  issueNumber: number;
  taskId: string;
  reason: string;
  retryCount: number;
}

export interface TaskRetryEvent {
  type: 'task-retry';
  issueNumber: number;
  taskId: string;
  attempt: number;
  maxAttempts: number;
  reason: string;
}

// ── Git events ──

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

// ── Budget events ──

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

export type CadreEvent =
  | FleetStartedEvent
  | FleetCompletedEvent
  | FleetInterruptedEvent
  | IssueStartedEvent
  | IssueCompletedEvent
  | IssueFailedEvent
  | PhaseStartedEvent
  | PhaseCompletedEvent
  | PhaseSkippedEvent
  | AgentLaunchedEvent
  | AgentCompletedEvent
  | AgentFailedEvent
  | TaskStartedEvent
  | TaskCompletedEvent
  | TaskBlockedEvent
  | TaskRetryEvent
  | GitCommitEvent
  | GitPushEvent
  | PRCreatedEvent
  | AmbiguityDetectedEvent
  | BudgetWarningEvent
  | BudgetExceededEvent;
