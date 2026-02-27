import type { NotificationManager } from '../notifications/manager.js';
import type { FleetProgressWriter } from './progress.js';

/**
 * Wraps NotificationManager and FleetProgressWriter to dispatch
 * fleet-level lifecycle and budget events.
 */
export class FleetEventBus {
  constructor(
    private readonly notifications: NotificationManager,
    private readonly fleetProgress: FleetProgressWriter,
  ) {}

  async dispatchFleetStarted(issueCount: number, maxParallel: number): Promise<void> {
    await this.notifications.dispatch({
      type: 'fleet-started',
      issueCount,
      maxParallel,
    });
  }

  async dispatchFleetCompleted(
    success: boolean,
    prsCreated: number,
    failedIssues: number,
    totalDuration: number,
    totalTokens: number,
  ): Promise<void> {
    await this.notifications.dispatch({
      type: 'fleet-completed',
      success,
      prsCreated,
      failedIssues,
      totalDuration,
      totalTokens,
    });
  }

  async dispatchBudgetExceeded(currentUsage: number, budget: number): Promise<void> {
    await this.notifications.dispatch({
      type: 'budget-exceeded',
      scope: 'fleet',
      currentUsage,
      budget,
    });
  }

  async dispatchBudgetWarning(currentUsage: number, budget: number, percentUsed: number): Promise<void> {
    await this.notifications.dispatch({
      type: 'budget-warning',
      scope: 'fleet',
      currentUsage,
      budget,
      percentUsed,
    });
  }

  async appendFleetStarted(issueCount: number): Promise<void> {
    await this.fleetProgress.appendEvent(
      `Fleet started: ${issueCount} issues`,
    );
  }

  async appendFleetCompleted(prsCreated: number, failedIssues: number): Promise<void> {
    await this.fleetProgress.appendEvent(
      `Fleet completed: ${prsCreated} PRs, ${failedIssues} failures`,
    );
  }
}
