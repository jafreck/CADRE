import type {
  CadreEvent,
  FleetStartedEvent,
  FleetCompletedEvent,
  FleetInterruptedEvent,
  IssueStartedEvent,
  IssueCompletedEvent,
  IssueFailedEvent,
  BudgetWarningEvent,
  BudgetExceededEvent,
  PhaseCompletedEvent,
  AmbiguityDetectedEvent,
} from '../logging/events.js';

export type { CadreEvent };

export type NotificationEvent =
  | FleetStartedEvent
  | FleetCompletedEvent
  | FleetInterruptedEvent
  | IssueStartedEvent
  | IssueCompletedEvent
  | IssueFailedEvent
  | PhaseCompletedEvent
  | AmbiguityDetectedEvent
  | BudgetWarningEvent
  | BudgetExceededEvent;

export interface NotificationProvider {
  notify(event: CadreEvent): Promise<void>;
}

// ── Dogfood triage types ──

export type DogfoodSeverity = 'critical' | 'severe' | 'high' | 'medium' | 'low';

export interface DogfoodSignal {
  event: CadreEvent;
  timestamp: string;
}

export interface DogfoodTopic {
  key: string;
  severity: DogfoodSeverity;
  severityJustification: string;
  summary: string;
  signals: DogfoodSignal[];
  subsystem: string;
  failureMode: string;
  impactScope: string;
}

export interface DogfoodTriageResult {
  filed: DogfoodTopic[];
  skippedBelowThreshold: DogfoodTopic[];
  skippedOverCap: DogfoodTopic[];
}
