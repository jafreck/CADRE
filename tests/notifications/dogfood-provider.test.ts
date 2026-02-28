import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DogfoodCollector } from '../../src/notifications/dogfood-provider.js';
import type { DogfoodCollectorConfig } from '../../src/notifications/dogfood-provider.js';
import type { GitHubAPI } from '../../src/github/api.js';
import type { CadreEvent } from '../../src/logging/events.js';

function makeGitHubAPI(overrides: Partial<GitHubAPI> = {}): GitHubAPI {
  return {
    createIssue: vi.fn().mockResolvedValue({ number: 1, url: 'https://github.com/owner/repo/issues/1' }),
    ...overrides,
  } as unknown as GitHubAPI;
}

function makeConfig(overrides: Partial<DogfoodCollectorConfig> = {}): DogfoodCollectorConfig {
  return {
    maxIssuesPerRun: 5,
    labels: ['cadre-dogfood'],
    titlePrefix: '[CADRE Dogfood]',
    minimumIssueLevel: 'low',
    ...overrides,
  };
}

function makeEvent(overrides: Partial<CadreEvent> = {}): CadreEvent {
  return {
    type: 'fleet-started',
    issueCount: 3,
    maxParallel: 2,
    ...overrides,
  } as CadreEvent;
}

describe('DogfoodCollector', () => {
  let mockApi: GitHubAPI;
  let config: DogfoodCollectorConfig;

  beforeEach(() => {
    vi.clearAllMocks();
    mockApi = makeGitHubAPI();
    config = makeConfig();
  });

  describe('notify', () => {
    it('should buffer events without creating GitHub issues', async () => {
      const collector = new DogfoodCollector(mockApi, config);
      await collector.notify(makeEvent());

      expect(mockApi.createIssue).not.toHaveBeenCalled();
    });

    it('should buffer multiple events', async () => {
      const collector = new DogfoodCollector(mockApi, config);
      await collector.notify(makeEvent());
      await collector.notify(makeEvent({ type: 'issue-failed', issueNumber: 1, issueTitle: 'test', error: 'err', phase: 1 } as CadreEvent));

      expect(mockApi.createIssue).not.toHaveBeenCalled();
    });
  });

  describe('runTriage', () => {
    it('should return empty result when only lifecycle events are buffered', async () => {
      const collector = new DogfoodCollector(mockApi, config);
      await collector.notify({ type: 'fleet-started', issueCount: 1, maxParallel: 1 });
      await collector.notify({ type: 'issue-started', issueNumber: 1, issueTitle: 'test', worktreePath: '/tmp' });
      await collector.notify({ type: 'phase-started', issueNumber: 1, phase: 1, phaseName: 'analysis' });
      await collector.notify({ type: 'phase-completed', issueNumber: 1, phase: 1, phaseName: 'analysis', duration: 100 });
      await collector.notify({ type: 'phase-skipped', issueNumber: 1, phase: 2, reason: 'not needed' });

      const result = await collector.runTriage();

      expect(result.filed).toHaveLength(0);
      expect(result.skippedBelowThreshold).toHaveLength(0);
      expect(result.skippedOverCap).toHaveLength(0);
    });

    it('should cluster events into topics by subsystem + failure mode + impact scope', async () => {
      const collector = new DogfoodCollector(mockApi, config);
      await collector.notify({ type: 'issue-failed', issueNumber: 1, issueTitle: 't', error: 'e1', phase: 1 });
      await collector.notify({ type: 'issue-failed', issueNumber: 1, issueTitle: 't', error: 'e2', phase: 2 });

      const result = await collector.runTriage();

      // Both events share the same subsystem:failureMode:impactScope -> one topic
      expect(result.filed).toHaveLength(1);
      expect(result.filed[0].key).toBe('issue-pipeline:issue-failure:issue-1');
      expect(result.filed[0].signals.length).toBeGreaterThanOrEqual(2);
    });

    it('should create separate topics for different keys', async () => {
      const collector = new DogfoodCollector(mockApi, config);
      await collector.notify({ type: 'issue-failed', issueNumber: 1, issueTitle: 't', error: 'e', phase: 1 });
      await collector.notify({ type: 'agent-failed', agent: 'scout', issueNumber: 2, error: 'timeout', timedOut: true });

      const result = await collector.runTriage();

      expect(result.filed.length).toBe(2);
      const keys = result.filed.map((t) => t.key);
      expect(keys).toContain('issue-pipeline:issue-failure:issue-1');
      expect(keys).toContain('agent:agent-timeout:issue-2');
    });

    it('should include lifecycle signals as supporting evidence in topics', async () => {
      const collector = new DogfoodCollector(mockApi, config);
      await collector.notify({ type: 'issue-started', issueNumber: 1, issueTitle: 'test', worktreePath: '/tmp' });
      await collector.notify({ type: 'issue-failed', issueNumber: 1, issueTitle: 'test', error: 'err', phase: 1 });

      const result = await collector.runTriage();

      expect(result.filed).toHaveLength(1);
      const topic = result.filed[0];
      const eventTypes = topic.signals.map((s) => s.event.type);
      expect(eventTypes).toContain('issue-started');
      expect(eventTypes).toContain('issue-failed');
    });

    it('should assign severity based on event types', async () => {
      const collector = new DogfoodCollector(mockApi, config);
      await collector.notify({ type: 'fleet-interrupted', signal: 'SIGTERM', issuesInProgress: [1, 2] });

      const result = await collector.runTriage();

      expect(result.filed).toHaveLength(1);
      expect(result.filed[0].severity).toBe('critical');
    });

    it('should file GitHub issues for topics above threshold', async () => {
      const collector = new DogfoodCollector(mockApi, config);
      await collector.notify({ type: 'issue-failed', issueNumber: 1, issueTitle: 'test', error: 'err', phase: 1 });

      const result = await collector.runTriage();

      expect(result.filed).toHaveLength(1);
      expect(mockApi.createIssue).toHaveBeenCalledOnce();
      const call = vi.mocked(mockApi.createIssue).mock.calls[0][0];
      expect(call.title).toContain('[CADRE Dogfood]');
      expect(call.body).toContain('issue-pipeline:issue-failure:issue-1');
      expect(call.body).toContain('Severity');
      expect(call.body).toContain('Aggregation Evidence');
      expect(call.body).toContain('Reproducibility Hints');
      expect(call.body).toContain('Suggested Labels');
    });
  });

  describe('severity threshold filtering', () => {
    it('should skip topics below the minimum issue level', async () => {
      const collector = new DogfoodCollector(mockApi, makeConfig({ minimumIssueLevel: 'high' }));
      // ambiguity-detected => low severity
      await collector.notify({ type: 'ambiguity-detected', issueNumber: 1, ambiguities: ['a'] });

      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const result = await collector.runTriage();
      logSpy.mockRestore();

      expect(result.filed).toHaveLength(0);
      expect(result.skippedBelowThreshold).toHaveLength(1);
      expect(mockApi.createIssue).not.toHaveBeenCalled();
    });

    it('should file topics at or above the minimum issue level', async () => {
      const collector = new DogfoodCollector(mockApi, makeConfig({ minimumIssueLevel: 'high' }));
      await collector.notify({ type: 'issue-failed', issueNumber: 1, issueTitle: 't', error: 'e', phase: 1 });

      const result = await collector.runTriage();

      expect(result.filed).toHaveLength(1);
      expect(result.filed[0].severity).toBe('high');
    });

    it('should log skip reasons for below-threshold topics', async () => {
      const collector = new DogfoodCollector(mockApi, makeConfig({ minimumIssueLevel: 'critical' }));
      await collector.notify({ type: 'issue-failed', issueNumber: 1, issueTitle: 't', error: 'e', phase: 1 });

      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      await collector.runTriage();

      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining('below threshold'),
      );
      logSpy.mockRestore();
    });
  });

  describe('max issues per run enforcement', () => {
    it('should cap filed topics at maxIssuesPerRun', async () => {
      const collector = new DogfoodCollector(mockApi, makeConfig({ maxIssuesPerRun: 1 }));
      await collector.notify({ type: 'issue-failed', issueNumber: 1, issueTitle: 't', error: 'e', phase: 1 });
      await collector.notify({ type: 'agent-failed', agent: 'scout', issueNumber: 2, error: 'err', timedOut: false });

      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const result = await collector.runTriage();
      logSpy.mockRestore();

      expect(result.filed).toHaveLength(1);
      expect(result.skippedOverCap).toHaveLength(1);
      expect(mockApi.createIssue).toHaveBeenCalledOnce();
    });

    it('should log rank and rationale for capped topics', async () => {
      const collector = new DogfoodCollector(mockApi, makeConfig({ maxIssuesPerRun: 1 }));
      await collector.notify({ type: 'issue-failed', issueNumber: 1, issueTitle: 't', error: 'e', phase: 1 });
      await collector.notify({ type: 'agent-failed', agent: 'scout', issueNumber: 2, error: 'err', timedOut: false });

      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      await collector.runTriage();

      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining('exceeds maxIssuesPerRun'),
      );
      logSpy.mockRestore();
    });
  });

  describe('topic deduplication', () => {
    it('should produce at most one topic per unique key', async () => {
      const collector = new DogfoodCollector(mockApi, config);
      // Multiple events with same subsystem:failureMode:impactScope
      await collector.notify({ type: 'issue-failed', issueNumber: 1, issueTitle: 't', error: 'e1', phase: 1 });
      await collector.notify({ type: 'issue-failed', issueNumber: 1, issueTitle: 't', error: 'e2', phase: 2 });
      await collector.notify({ type: 'issue-failed', issueNumber: 1, issueTitle: 't', error: 'e3', phase: 3 });

      const result = await collector.runTriage();

      expect(result.filed).toHaveLength(1);
      expect(mockApi.createIssue).toHaveBeenCalledOnce();
    });
  });

  describe('error handling', () => {
    it('should catch and log errors during issue filing without throwing', async () => {
      const failingApi = makeGitHubAPI({
        createIssue: vi.fn().mockRejectedValue(new Error('network error')),
      });
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const collector = new DogfoodCollector(failingApi, config);
      await collector.notify({ type: 'issue-failed', issueNumber: 1, issueTitle: 't', error: 'e', phase: 1 });

      const result = await collector.runTriage();

      expect(result.filed).toHaveLength(1);
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('DogfoodCollector: failed to file issue'),
      );
      consoleSpy.mockRestore();
    });

    it('should never throw from runTriage even on unexpected errors', async () => {
      const collector = new DogfoodCollector(mockApi, config);
      // Tamper with internals to cause an error
      (collector as any).signals = null;

      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      await expect(collector.runTriage()).resolves.toBeDefined();
      consoleSpy.mockRestore();
    });
  });

  describe('severity classification', () => {
    it('should classify fleet-interrupted as critical', async () => {
      const collector = new DogfoodCollector(mockApi, config);
      await collector.notify({ type: 'fleet-interrupted', signal: 'SIGTERM', issuesInProgress: [1] });
      const result = await collector.runTriage();
      expect(result.filed[0].severity).toBe('critical');
      expect(result.filed[0].severityJustification).toContain('interrupted');
    });

    it('should classify budget-exceeded as severe', async () => {
      const collector = new DogfoodCollector(mockApi, config);
      await collector.notify({ type: 'budget-exceeded', scope: 'fleet', currentUsage: 110, budget: 100 });
      const result = await collector.runTriage();
      expect(result.filed[0].severity).toBe('severe');
      expect(result.filed[0].severityJustification).toContain('Budget exceeded');
    });

    it('should classify multiple issue-failed as severe', async () => {
      const collector = new DogfoodCollector(mockApi, config);
      await collector.notify({ type: 'issue-failed', issueNumber: 1, issueTitle: 't1', error: 'e1', phase: 1 });
      await collector.notify({ type: 'issue-failed', issueNumber: 1, issueTitle: 't1', error: 'e2', Animals: 2 } as any);
      const result = await collector.runTriage();
      // Both are same key (issue-pipeline:issue-failure:issue-1) with 2 signals
      expect(result.filed[0].severity).toBe('severe');
    });

    it('should classify single issue-failed as high', async () => {
      const collector = new DogfoodCollector(mockApi, config);
      await collector.notify({ type: 'issue-failed', issueNumber: 1, issueTitle: 't', error: 'e', phase: 1 });
      const result = await collector.runTriage();
      expect(result.filed[0].severity).toBe('high');
    });

    it('should classify agent-failed as high', async () => {
      const collector = new DogfoodCollector(mockApi, config);
      await collector.notify({ type: 'agent-failed', agent: 'scout', issueNumber: 1, error: 'err', timedOut: false });
      const result = await collector.runTriage();
      expect(result.filed[0].severity).toBe('high');
    });

    it('should classify task-blocked as medium', async () => {
      const collector = new DogfoodCollector(mockApi, config);
      await collector.notify({ type: 'task-blocked', issueNumber: 1, taskId: 't1', reason: 'blocked', retryCount: 3 });
      const result = await collector.runTriage();
      expect(result.filed[0].severity).toBe('medium');
    });

    it('should classify task-retry as medium', async () => {
      const collector = new DogfoodCollector(mockApi, config);
      await collector.notify({ type: 'task-retry', issueNumber: 1, taskId: 't1', attempt: 2, maxAttempts: 3, reason: 'error' });
      const result = await collector.runTriage();
      expect(result.filed[0].severity).toBe('medium');
    });

    it('should classify budget-warning as medium', async () => {
      const collector = new DogfoodCollector(mockApi, config);
      await collector.notify({ type: 'budget-warning', scope: 'fleet', currentUsage: 90, budget: 100, percentUsed: 90 });
      const result = await collector.runTriage();
      expect(result.filed[0].severity).toBe('medium');
    });

    it('should classify ambiguity-detected as low', async () => {
      const collector = new DogfoodCollector(mockApi, config);
      await collector.notify({ type: 'ambiguity-detected', issueNumber: 1, ambiguities: ['a'] });
      const result = await collector.runTriage();
      expect(result.filed[0].severity).toBe('low');
    });
  });

  describe('subsystem and impact classification', () => {
    it('should assign fleet subsystem for fleet events', async () => {
      const collector = new DogfoodCollector(mockApi, config);
      await collector.notify({ type: 'fleet-interrupted', signal: 'SIGTERM', issuesInProgress: [] });
      const result = await collector.runTriage();
      expect(result.filed[0].subsystem).toBe('fleet');
    });

    it('should assign agent subsystem for agent events', async () => {
      const collector = new DogfoodCollector(mockApi, config);
      await collector.notify({ type: 'agent-failed', agent: 'scout', issueNumber: 1, error: 'err', timedOut: true });
      const result = await collector.runTriage();
      expect(result.filed[0].subsystem).toBe('agent');
      expect(result.filed[0].failureMode).toBe('agent-timeout');
    });

    it('should assign agent-error failure mode when not timed out', async () => {
      const collector = new DogfoodCollector(mockApi, config);
      await collector.notify({ type: 'agent-failed', agent: 'scout', issueNumber: 1, error: 'err', timedOut: false });
      const result = await collector.runTriage();
      expect(result.filed[0].failureMode).toBe('agent-error');
    });

    it('should use fleet as impact scope for events without issueNumber', async () => {
      const collector = new DogfoodCollector(mockApi, config);
      await collector.notify({ type: 'fleet-interrupted', signal: 'SIGTERM', issuesInProgress: [] });
      const result = await collector.runTriage();
      expect(result.filed[0].impactScope).toBe('fleet');
    });

    it('should use issue-N as impact scope for events with issueNumber', async () => {
      const collector = new DogfoodCollector(mockApi, config);
      await collector.notify({ type: 'issue-failed', issueNumber: 42, issueTitle: 't', error: 'e', phase: 1 });
      const result = await collector.runTriage();
      expect(result.filed[0].impactScope).toBe('issue-42');
    });

    it('should assign git subsystem for pr-created events', async () => {
      const collector = new DogfoodCollector(mockApi, config);
      // pr-created has failureMode 'info', which is lifecycle-like but not in LIFECYCLE_EVENT_TYPES
      await collector.notify({ type: 'pr-created', issueNumber: 1, prNumber: 10, prUrl: 'https://example.com' });
      const result = await collector.runTriage();
      // pr-created is not a lifecycle event, so it creates a topic
      expect(result.filed[0].subsystem).toBe('git');
    });
  });

  describe('issue body content', () => {
    it('should include topic key, severity, and aggregation evidence in the issue body', async () => {
      const collector = new DogfoodCollector(mockApi, config);
      await collector.notify({ type: 'issue-failed', issueNumber: 1, issueTitle: 'test', error: 'err', phase: 1 });
      await collector.runTriage();

      const call = vi.mocked(mockApi.createIssue).mock.calls[0][0];
      expect(call.body).toContain('issue-pipeline:issue-failure:issue-1');
      expect(call.body).toContain('**Severity:** high');
      expect(call.body).toContain('**Signal count:**');
      expect(call.body).toContain('#1');
      expect(call.body).toContain('Reproducibility Hints');
      expect(call.body).toContain('`issue-pipeline`');
      expect(call.body).toContain('`issue-failure`');
    });

    it('should show fleet-level for events without affected issues', async () => {
      const collector = new DogfoodCollector(mockApi, config);
      await collector.notify({ type: 'fleet-interrupted', signal: 'SIGTERM', issuesInProgress: [] });
      await collector.runTriage();

      const call = vi.mocked(mockApi.createIssue).mock.calls[0][0];
      expect(call.body).toContain('fleet-level');
    });

    it('should include suggested component labels', async () => {
      const collector = new DogfoodCollector(mockApi, config);
      await collector.notify({ type: 'issue-failed', issueNumber: 1, issueTitle: 't', error: 'e', phase: 1 });
      await collector.runTriage();

      const call = vi.mocked(mockApi.createIssue).mock.calls[0][0];
      expect(call.labels).toContain('cadre-dogfood');
      expect(call.labels).toContain('component:issue-pipeline');
    });

    it('should include priority:high label for critical severity', async () => {
      const collector = new DogfoodCollector(mockApi, config);
      await collector.notify({ type: 'fleet-interrupted', signal: 'SIGTERM', issuesInProgress: [] });
      await collector.runTriage();

      const call = vi.mocked(mockApi.createIssue).mock.calls[0][0];
      expect(call.labels).toContain('priority:high');
    });

    it('should not include priority:high label for medium severity', async () => {
      const collector = new DogfoodCollector(mockApi, config);
      await collector.notify({ type: 'task-blocked', issueNumber: 1, taskId: 't1', reason: 'blocked', retryCount: 3 });
      await collector.runTriage();

      const call = vi.mocked(mockApi.createIssue).mock.calls[0][0];
      expect(call.labels).not.toContain('priority:high');
    });
  });

  describe('severity sorting', () => {
    it('should sort topics by severity with most severe first', async () => {
      const collector = new DogfoodCollector(mockApi, config);
      // low severity (ambiguity)
      await collector.notify({ type: 'ambiguity-detected', issueNumber: 1, ambiguities: ['a'] });
      // critical severity (fleet-interrupted)
      await collector.notify({ type: 'fleet-interrupted', signal: 'SIGTERM', issuesInProgress: [] });
      // high severity (issue-failed)
      await collector.notify({ type: 'issue-failed', issueNumber: 2, issueTitle: 't', error: 'e', phase: 1 });

      const result = await collector.runTriage();

      expect(result.filed[0].severity).toBe('critical');
      expect(result.filed[1].severity).toBe('high');
      expect(result.filed[2].severity).toBe('low');
    });
  });
});
