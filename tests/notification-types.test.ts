import { describe, it, expect, vi } from 'vitest';
import type {
  NotificationProvider,
  NotificationEvent,
  CadreEvent,
  DogfoodSeverity,
  DogfoodSignal,
  DogfoodTopic,
  DogfoodTriageResult,
} from '../src/notifications/types.js';

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

describe('DogfoodSeverity type', () => {
  it('should accept all valid severity levels', () => {
    const levels: DogfoodSeverity[] = ['critical', 'severe', 'high', 'medium', 'low'];
    expect(levels).toHaveLength(5);
    expect(levels).toContain('critical');
    expect(levels).toContain('severe');
    expect(levels).toContain('high');
    expect(levels).toContain('medium');
    expect(levels).toContain('low');
  });
});

describe('DogfoodSignal interface', () => {
  it('should hold a CadreEvent and a timestamp', () => {
    const signal: DogfoodSignal = {
      event: { type: 'fleet-started', issueCount: 1, maxParallel: 1 },
      timestamp: '2026-01-01T00:00:00.000Z',
    };
    expect(signal.event.type).toBe('fleet-started');
    expect(signal.timestamp).toBe('2026-01-01T00:00:00.000Z');
  });
});

describe('DogfoodTopic interface', () => {
  it('should contain key, severity, signals, and subsystem metadata', () => {
    const topic: DogfoodTopic = {
      key: 'issue-pipeline:issue-failure:issue-1',
      severity: 'high',
      severityJustification: 'Issue pipeline failure',
      summary: 'issue-pipeline issue-failure in issue-1 (1 signal)',
      signals: [{ event: { type: 'issue-failed', issueNumber: 1, issueTitle: 't', error: 'e', phase: 1 }, timestamp: '2026-01-01T00:00:00.000Z' }],
      subsystem: 'issue-pipeline',
      failureMode: 'issue-failure',
      impactScope: 'issue-1',
    };
    expect(topic.key).toBe('issue-pipeline:issue-failure:issue-1');
    expect(topic.severity).toBe('high');
    expect(topic.severityJustification).toBe('Issue pipeline failure');
    expect(topic.signals).toHaveLength(1);
    expect(topic.subsystem).toBe('issue-pipeline');
    expect(topic.failureMode).toBe('issue-failure');
    expect(topic.impactScope).toBe('issue-1');
  });
});

describe('DogfoodTriageResult interface', () => {
  it('should contain filed, skippedBelowThreshold, and skippedOverCap arrays', () => {
    const result: DogfoodTriageResult = {
      filed: [],
      skippedBelowThreshold: [],
      skippedOverCap: [],
    };
    expect(result.filed).toEqual([]);
    expect(result.skippedBelowThreshold).toEqual([]);
    expect(result.skippedOverCap).toEqual([]);
  });

  it('should accept populated arrays', () => {
    const topic: DogfoodTopic = {
      key: 'fleet:fleet-interrupted:fleet',
      severity: 'critical',
      severityJustification: 'Fleet was interrupted',
      summary: 'fleet fleet-interrupted in fleet (1 signal)',
      signals: [{ event: { type: 'fleet-interrupted', signal: 'SIGTERM', issuesInProgress: [1] }, timestamp: '2026-01-01T00:00:00.000Z' }],
      subsystem: 'fleet',
      failureMode: 'fleet-interrupted',
      impactScope: 'fleet',
    };
    const result: DogfoodTriageResult = {
      filed: [topic],
      skippedBelowThreshold: [],
      skippedOverCap: [],
    };
    expect(result.filed).toHaveLength(1);
    expect(result.filed[0].severity).toBe('critical');
  });
});
