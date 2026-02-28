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
  DogfoodTriageCompletedEvent,
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
  | BudgetExceededEvent
  | DogfoodTriageCompletedEvent;

export interface NotificationProvider {
  notify(event: CadreEvent): Promise<void>;
}
