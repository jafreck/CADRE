import type { NotificationManager } from '@cadre-dev/framework/notifications';

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
      workItemId: String(this.issueNumber),
      issueTitle: this.issueTitle,
      worktreePath,
    });
  }

  async notifyPhaseCompleted(phase: number, phaseName: string, duration: number): Promise<void> {
    await this.notificationManager.dispatch({
      type: 'phase-completed',
      workItemId: String(this.issueNumber),
      phase,
      phaseName,
      duration,
    });
  }

  async notifyIssueFailed(error: string, phase: number, phaseName?: string): Promise<void> {
    await this.notificationManager.dispatch({
      type: 'issue-failed',
      workItemId: String(this.issueNumber),
      issueTitle: this.issueTitle,
      error,
      phase,
      phaseName,
    });
  }

  async notifyIssueCompleted(success: boolean, duration: number, tokenUsage: number): Promise<void> {
    await this.notificationManager.dispatch({
      type: 'issue-completed',
      workItemId: String(this.issueNumber),
      issueTitle: this.issueTitle,
      success,
      duration,
      tokenUsage,
    });
  }
}
