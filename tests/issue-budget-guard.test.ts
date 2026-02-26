import { describe, it, expect, vi, beforeEach } from 'vitest';
import { IssueBudgetGuard, BudgetExceededError } from '../src/core/issue-budget-guard.js';
import type { TokenTracker } from '../src/budget/token-tracker.js';
import type { NotificationManager } from '../src/notifications/manager.js';
import type { CheckpointManager } from '../src/core/checkpoint.js';
import type { CheckpointState } from '../src/core/checkpoint.js';

function makeTokenTracker(overrides: {
  getTotal?: () => number;
  checkIssueBudget?: (issueNumber: number, budget?: number) => 'ok' | 'warning' | 'exceeded';
  record?: () => void;
} = {}): TokenTracker {
  return {
    record: vi.fn(),
    getTotal: vi.fn().mockReturnValue(0),
    checkIssueBudget: vi.fn().mockReturnValue('ok'),
    ...overrides,
  } as unknown as TokenTracker;
}

function makeNotificationManager(): NotificationManager {
  return {
    dispatch: vi.fn().mockResolvedValue(undefined),
  } as unknown as NotificationManager;
}

function makeCheckpoint(currentPhase = 1): CheckpointManager {
  return {
    getState: vi.fn().mockReturnValue({ currentPhase } as unknown as CheckpointState),
    recordTokenUsage: vi.fn().mockResolvedValue(undefined),
  } as unknown as CheckpointManager;
}

describe('IssueBudgetGuard', () => {
  const ISSUE_NUMBER = 42;
  const TOKEN_BUDGET = 10_000;

  describe('recordTokens', () => {
    it('records tokens to TokenTracker and CheckpointManager when count > 0', async () => {
      const tracker = makeTokenTracker();
      const checkpoint = makeCheckpoint();
      const notifier = makeNotificationManager();
      const guard = new IssueBudgetGuard(tracker, notifier, checkpoint, ISSUE_NUMBER, TOKEN_BUDGET);

      guard.recordTokens('scout', 500);

      expect(tracker.record).toHaveBeenCalledWith(ISSUE_NUMBER, 'scout', 1, 500, undefined, undefined);
      // allow async void to flush
      await Promise.resolve();
      expect(checkpoint.recordTokenUsage).toHaveBeenCalledWith('scout', 1, 500);
    });

    it('records input/output detail when TokenUsageDetail is provided', async () => {
      const tracker = makeTokenTracker();
      const checkpoint = makeCheckpoint();
      const guard = new IssueBudgetGuard(tracker, makeNotificationManager(), checkpoint, ISSUE_NUMBER, TOKEN_BUDGET);

      guard.recordTokens('analyst', { input: 300, output: 200 });

      expect(tracker.record).toHaveBeenCalledWith(ISSUE_NUMBER, 'analyst', 1, 500, 300, 200);
    });

    it('does not record when tokens is null', () => {
      const tracker = makeTokenTracker();
      const checkpoint = makeCheckpoint();
      const guard = new IssueBudgetGuard(tracker, makeNotificationManager(), checkpoint, ISSUE_NUMBER, TOKEN_BUDGET);

      guard.recordTokens('scout', null);

      expect(tracker.record).not.toHaveBeenCalled();
      expect(checkpoint.recordTokenUsage).not.toHaveBeenCalled();
    });

    it('does not record when tokens is 0', () => {
      const tracker = makeTokenTracker();
      const checkpoint = makeCheckpoint();
      const guard = new IssueBudgetGuard(tracker, makeNotificationManager(), checkpoint, ISSUE_NUMBER, TOKEN_BUDGET);

      guard.recordTokens('scout', 0);

      expect(tracker.record).not.toHaveBeenCalled();
    });

    it('sets budgetExceeded=true when checkIssueBudget returns exceeded', () => {
      const tracker = makeTokenTracker({
        checkIssueBudget: vi.fn().mockReturnValue('exceeded'),
      });
      const guard = new IssueBudgetGuard(tracker, makeNotificationManager(), makeCheckpoint(), ISSUE_NUMBER, TOKEN_BUDGET);

      expect(guard.budgetExceeded).toBe(false);
      guard.recordTokens('agent', 9_000);
      expect(guard.budgetExceeded).toBe(true);
    });

    it('dispatches budget-warning notification exactly once on warning transition', async () => {
      const tracker = makeTokenTracker({
        getTotal: vi.fn().mockReturnValue(8_500),
        checkIssueBudget: vi.fn().mockReturnValue('warning'),
      });
      const notifier = makeNotificationManager();
      const guard = new IssueBudgetGuard(tracker, notifier, makeCheckpoint(), ISSUE_NUMBER, TOKEN_BUDGET);

      guard.recordTokens('agent', 8_500);
      guard.recordTokens('agent', 100); // second call, should NOT fire again

      await Promise.resolve(); // flush void promise

      expect(notifier.dispatch).toHaveBeenCalledTimes(1);
      expect(notifier.dispatch).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'budget-warning', scope: 'issue', issueNumber: ISSUE_NUMBER }),
      );
    });

    it('does not dispatch budget-warning when budget is exceeded (exceeded takes priority)', () => {
      const checkIssueBudget = vi.fn()
        .mockReturnValueOnce('exceeded')  // first call → exceeded
        .mockReturnValue('warning');       // subsequent calls → warning
      const tracker = makeTokenTracker({ checkIssueBudget });
      const notifier = makeNotificationManager();
      const guard = new IssueBudgetGuard(tracker, notifier, makeCheckpoint(), ISSUE_NUMBER, TOKEN_BUDGET);

      guard.recordTokens('agent', 11_000);

      expect(guard.budgetExceeded).toBe(true);
      expect(notifier.dispatch).not.toHaveBeenCalled();
    });
  });

  describe('checkBudget', () => {
    it('does not throw when budget is not exceeded', () => {
      const guard = new IssueBudgetGuard(makeTokenTracker(), makeNotificationManager(), makeCheckpoint(), ISSUE_NUMBER, TOKEN_BUDGET);
      expect(() => guard.checkBudget()).not.toThrow();
    });

    it('throws BudgetExceededError when budget is exceeded', () => {
      const tracker = makeTokenTracker({
        checkIssueBudget: vi.fn().mockReturnValue('exceeded'),
      });
      const guard = new IssueBudgetGuard(tracker, makeNotificationManager(), makeCheckpoint(), ISSUE_NUMBER, TOKEN_BUDGET);
      guard.recordTokens('agent', 10_001);
      expect(() => guard.checkBudget()).toThrow(BudgetExceededError);
    });

    it('thrown error has correct name and message', () => {
      const tracker = makeTokenTracker({
        checkIssueBudget: vi.fn().mockReturnValue('exceeded'),
      });
      const guard = new IssueBudgetGuard(tracker, makeNotificationManager(), makeCheckpoint(), ISSUE_NUMBER, TOKEN_BUDGET);
      guard.recordTokens('agent', 10_001);
      let err: unknown;
      try { guard.checkBudget(); } catch (e) { err = e; }
      expect(err).toBeInstanceOf(BudgetExceededError);
      expect((err as Error).name).toBe('BudgetExceededError');
      expect((err as Error).message).toBe('Per-issue token budget exceeded');
    });
  });
});
