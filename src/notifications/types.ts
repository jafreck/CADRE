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
} from '../logging/events.js';

export type { CadreEvent };

export type NotificationEvent =
  | FleetStartedEvent
  | FleetCompletedEvent
  | FleetInterruptedEvent
  | IssueStartedEvent
  | IssueCompletedEvent
  | IssueFailedEvent
  | BudgetWarningEvent
  | BudgetExceededEvent;

export interface NotificationProvider {
  notify(event: CadreEvent): Promise<void>;
}
