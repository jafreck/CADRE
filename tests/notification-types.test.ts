import { describe, it, expect, vi } from 'vitest';
import type { NotificationProvider, NotificationEvent, CadreEvent } from '../src/notifications/types.js';

describe('NotificationProvider interface', () => {
  it('should be implementable as a class', async () => {
    class MockProvider implements NotificationProvider {
      notify = vi.fn().mockResolvedValue(undefined);
    }
    const provider = new MockProvider();
    expect(provider.notify).toBeDefined();
    const event: CadreEvent = { type: 'fleet-started', issueCount: 1, maxParallel: 1 };
    await provider.notify(event);
    expect(provider.notify).toHaveBeenCalledWith(event);
  });

  it('should accept any CadreEvent in notify()', async () => {
    const calls: CadreEvent[] = [];
    const provider: NotificationProvider = {
      async notify(event) {
        calls.push(event);
      },
    };

    const events: CadreEvent[] = [
      { type: 'fleet-started', issueCount: 2, maxParallel: 3 },
      { type: 'fleet-completed', success: true, prsCreated: 1, failedIssues: 0, totalDuration: 100, totalTokens: 500 },
      { type: 'issue-started', issueNumber: 42, issueTitle: 'Fix bug', worktreePath: '/tmp/wt' },
    ];

    for (const event of events) {
      await provider.notify(event);
    }

    expect(calls).toHaveLength(3);
    expect(calls[0].type).toBe('fleet-started');
    expect(calls[1].type).toBe('fleet-completed');
    expect(calls[2].type).toBe('issue-started');
  });

  it('should return a Promise from notify()', async () => {
    const provider: NotificationProvider = {
      notify: vi.fn().mockResolvedValue(undefined),
    };
    const result = provider.notify({ type: 'budget-warning', scope: 'fleet', currentUsage: 90, budget: 100, percentUsed: 90 });
    expect(result).toBeInstanceOf(Promise);
    await expect(result).resolves.toBeUndefined();
  });
});

describe('NotificationEvent type union', () => {
  it('should accept fleet-started event', () => {
    const event: NotificationEvent = { type: 'fleet-started', issueCount: 5, maxParallel: 2 };
    expect(event.type).toBe('fleet-started');
  });

  it('should accept fleet-completed event', () => {
    const event: NotificationEvent = {
      type: 'fleet-completed',
      success: true,
      prsCreated: 3,
      failedIssues: 0,
      totalDuration: 3600,
      totalTokens: 10000,
    };
    expect(event.type).toBe('fleet-completed');
  });

  it('should accept fleet-interrupted event', () => {
    const event: NotificationEvent = { type: 'fleet-interrupted', signal: 'SIGINT', issuesInProgress: [1, 2] };
    expect(event.type).toBe('fleet-interrupted');
  });

  it('should accept issue-started event', () => {
    const event: NotificationEvent = { type: 'issue-started', issueNumber: 42, issueTitle: 'Fix bug', worktreePath: '/tmp/wt' };
    expect(event.type).toBe('issue-started');
  });

  it('should accept issue-completed event', () => {
    const event: NotificationEvent = { type: 'issue-completed', issueNumber: 42, issueTitle: 'Fix bug', success: true, prNumber: 99, duration: 120, tokenUsage: 5000 };
    expect(event.type).toBe('issue-completed');
  });

  it('should accept issue-failed event', () => {
    const event: NotificationEvent = { type: 'issue-failed', issueNumber: 42, issueTitle: 'Fix bug', error: 'timeout', phase: 2 };
    expect(event.type).toBe('issue-failed');
  });

  it('should accept budget-warning event', () => {
    const event: NotificationEvent = { type: 'budget-warning', scope: 'issue', issueNumber: 42, currentUsage: 80, budget: 100, percentUsed: 80 };
    expect(event.type).toBe('budget-warning');
  });

  it('should accept budget-exceeded event', () => {
    const event: NotificationEvent = { type: 'budget-exceeded', scope: 'fleet', currentUsage: 110, budget: 100 };
    expect(event.type).toBe('budget-exceeded');
  });

  it('should cover all 8 notification event types', () => {
    const notificationTypes: NotificationEvent['type'][] = [
      'fleet-started',
      'fleet-completed',
      'fleet-interrupted',
      'issue-started',
      'issue-completed',
      'issue-failed',
      'budget-warning',
      'budget-exceeded',
    ];
    expect(notificationTypes).toHaveLength(8);
  });
});
