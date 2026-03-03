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
} from '@cadre/framework/core';

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
