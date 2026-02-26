import type { NotificationManager } from '../notifications/manager.js';

/**
 * Dispatches typed lifecycle notification events for an issue pipeline.
 */
export class IssueLifecycleNotifier {
  constructor(
    private readonly notificationManager: NotificationManager,
    private readonly issueNumber: number,
    private readonly issueTitle: string,
  ) {}

  async notifyIssueStarted(worktreePath: string): Promise<void> {
    await this.notificationManager.dispatch({
      type: 'issue-started',
      issueNumber: this.issueNumber,
      issueTitle: this.issueTitle,
      worktreePath,
    });
  }

  async notifyPhaseCompleted(phase: number, phaseName: string, duration: number): Promise<void> {
    await this.notificationManager.dispatch({
      type: 'phase-completed',
      issueNumber: this.issueNumber,
      phase,
      phaseName,
      duration,
    });
  }

  async notifyIssueFailed(error: string, phase: number, phaseName?: string): Promise<void> {
    await this.notificationManager.dispatch({
      type: 'issue-failed',
      issueNumber: this.issueNumber,
      issueTitle: this.issueTitle,
      error,
      phase,
      phaseName,
    });
  }

  async notifyIssueCompleted(success: boolean, duration: number, tokenUsage: number): Promise<void> {
    await this.notificationManager.dispatch({
      type: 'issue-completed',
      issueNumber: this.issueNumber,
      issueTitle: this.issueTitle,
      success,
      duration,
      tokenUsage,
    });
  }
}
