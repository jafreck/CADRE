import { describe, it, expect, vi, beforeEach } from 'vitest';
import { IssueLifecycleNotifier } from '../src/core/issue-lifecycle-notifier.js';
import type { NotificationManager } from '../src/notifications/manager.js';

function makeNotificationManager(): NotificationManager {
  return {
    dispatch: vi.fn().mockResolvedValue(undefined),
  } as unknown as NotificationManager;
}

describe('IssueLifecycleNotifier', () => {
  const ISSUE_NUMBER = 99;
  const ISSUE_TITLE = 'Fix the bug';
  let notifier: IssueLifecycleNotifier;
  let manager: NotificationManager;

  beforeEach(() => {
    manager = makeNotificationManager();
    notifier = new IssueLifecycleNotifier(manager, ISSUE_NUMBER, ISSUE_TITLE);
  });

  describe('notifyIssueStarted', () => {
    it('dispatches issue-started event with correct fields', async () => {
      const worktreePath = '/tmp/worktrees/issue-99';
      await notifier.notifyIssueStarted(worktreePath);

      expect(manager.dispatch).toHaveBeenCalledOnce();
      expect(manager.dispatch).toHaveBeenCalledWith({
        type: 'issue-started',
        issueNumber: ISSUE_NUMBER,
        issueTitle: ISSUE_TITLE,
        worktreePath,
      });
    });
  });

  describe('notifyPhaseCompleted', () => {
    it('dispatches phase-completed event with correct fields', async () => {
      await notifier.notifyPhaseCompleted(2, 'Implementation', 4500);

      expect(manager.dispatch).toHaveBeenCalledOnce();
      expect(manager.dispatch).toHaveBeenCalledWith({
        type: 'phase-completed',
        issueNumber: ISSUE_NUMBER,
        phase: 2,
        phaseName: 'Implementation',
        duration: 4500,
      });
    });
  });

  describe('notifyIssueFailed', () => {
    it('dispatches issue-failed event with error and phase fields', async () => {
      await notifier.notifyIssueFailed('Something went wrong', 3);

      expect(manager.dispatch).toHaveBeenCalledOnce();
      expect(manager.dispatch).toHaveBeenCalledWith({
        type: 'issue-failed',
        issueNumber: ISSUE_NUMBER,
        issueTitle: ISSUE_TITLE,
        error: 'Something went wrong',
        phase: 3,
        phaseName: undefined,
      });
    });

    it('includes phaseName when provided', async () => {
      await notifier.notifyIssueFailed('Timed out', 4, 'PR Composition');

      expect(manager.dispatch).toHaveBeenCalledWith(
        expect.objectContaining({ phaseName: 'PR Composition' }),
      );
    });
  });

  describe('notifyIssueCompleted', () => {
    it('dispatches issue-completed event with success, duration, and tokenUsage', async () => {
      await notifier.notifyIssueCompleted(true, 12000, 7500);

      expect(manager.dispatch).toHaveBeenCalledOnce();
      expect(manager.dispatch).toHaveBeenCalledWith({
        type: 'issue-completed',
        issueNumber: ISSUE_NUMBER,
        issueTitle: ISSUE_TITLE,
        success: true,
        duration: 12000,
        tokenUsage: 7500,
      });
    });

    it('dispatches with success=false when issue failed', async () => {
      await notifier.notifyIssueCompleted(false, 3000, 2000);

      expect(manager.dispatch).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'issue-completed', success: false }),
      );
    });
  });
});
