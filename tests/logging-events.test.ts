import { describe, it, expect } from 'vitest';
import type {
  CadreEvent,
  FleetStartedEvent,
  FleetCompletedEvent,
  FleetInterruptedEvent,
  IssueStartedEvent,
  IssueCompletedEvent,
  IssueFailedEvent,
  PhaseStartedEvent,
  PhaseCompletedEvent,
  PhaseSkippedEvent,
  AgentLaunchedEvent,
  AgentCompletedEvent,
  AgentFailedEvent,
  TaskStartedEvent,
  TaskCompletedEvent,
  TaskBlockedEvent,
  TaskRetryEvent,
  GitCommitEvent,
  GitPushEvent,
  PRCreatedEvent,
  AmbiguityDetectedEvent,
  BudgetWarningEvent,
  BudgetExceededEvent,
  IsolationSessionStartedEvent,
  IsolationSessionEndedEvent,
  IsolationCapabilityDowngradeEvent,
  LogEntry,
  LogLevel,
} from '../src/logging/events.js';

/**
 * Narrows a CadreEvent to a specific type using the discriminant `type` field.
 * This exercises the union type discriminant at runtime.
 */
function narrowEvent<T extends CadreEvent['type']>(
  event: CadreEvent,
  type: T,
): Extract<CadreEvent, { type: T }> | null {
  return event.type === type ? (event as Extract<CadreEvent, { type: T }>) : null;
}

describe('CadreEvent type definitions', () => {
  describe('Fleet events', () => {
    it('FleetStartedEvent has required fields', () => {
      const event: FleetStartedEvent = { type: 'fleet-started', issueCount: 3, maxParallel: 2 };
      expect(event.type).toBe('fleet-started');
      expect(event.issueCount).toBe(3);
      expect(event.maxParallel).toBe(2);
    });

    it('FleetCompletedEvent has required fields', () => {
      const event: FleetCompletedEvent = {
        type: 'fleet-completed',
        success: true,
        prsCreated: 2,
        failedIssues: 0,
        totalDuration: 9500,
        totalTokens: 42000,
      };
      expect(event.type).toBe('fleet-completed');
      expect(event.success).toBe(true);
    });

    it('FleetInterruptedEvent carries signal and active issues', () => {
      const event: FleetInterruptedEvent = {
        type: 'fleet-interrupted',
        signal: 'SIGINT',
        issuesInProgress: [1, 2],
      };
      expect(event.type).toBe('fleet-interrupted');
      expect(event.signal).toBe('SIGINT');
      expect(event.issuesInProgress).toEqual([1, 2]);
    });
  });

  describe('Issue events', () => {
    it('IssueStartedEvent has required fields', () => {
      const event: IssueStartedEvent = {
        type: 'issue-started',
        issueNumber: 42,
        issueTitle: 'Fix login',
        worktreePath: '/tmp/worktrees/issue-42',
      };
      expect(event.type).toBe('issue-started');
    });

    it('IssueCompletedEvent has optional prNumber and prUrl', () => {
      const withPR: IssueCompletedEvent = {
        type: 'issue-completed',
        issueNumber: 42,
        issueTitle: 'Fix login',
        success: true,
        prNumber: 101,
        prUrl: 'https://github.com/owner/repo/pull/101',
        duration: 5000,
        tokenUsage: 1200,
      };
      expect(withPR.prNumber).toBe(101);

      const noPR: IssueCompletedEvent = {
        type: 'issue-completed',
        issueNumber: 43,
        issueTitle: 'Fix logout',
        success: false,
        duration: 3000,
        tokenUsage: 800,
      };
      expect(noPR.prNumber).toBeUndefined();
    });

    it('IssueFailedEvent captures phase and optional phaseName', () => {
      const event: IssueFailedEvent = {
        type: 'issue-failed',
        issueNumber: 7,
        issueTitle: 'Broken feature',
        error: 'Timeout',
        phase: 2,
        phaseName: 'Implementation',
        failedTask: 'task-a',
      };
      expect(event.phase).toBe(2);
      expect(event.phaseName).toBe('Implementation');
    });
  });

  describe('Phase events', () => {
    it('PhaseStartedEvent has phase number and name', () => {
      const event: PhaseStartedEvent = {
        type: 'phase-started',
        issueNumber: 1,
        phase: 1,
        phaseName: 'Analysis',
      };
      expect(event.phase).toBe(1);
    });

    it('PhaseCompletedEvent includes duration', () => {
      const event: PhaseCompletedEvent = {
        type: 'phase-completed',
        issueNumber: 1,
        phase: 2,
        phaseName: 'Implementation',
        duration: 4200,
      };
      expect(event.duration).toBe(4200);
    });

    it('PhaseSkippedEvent has a reason', () => {
      const event: PhaseSkippedEvent = {
        type: 'phase-skipped',
        issueNumber: 1,
        phase: 3,
        reason: 'gate failed',
      };
      expect(event.reason).toBe('gate failed');
    });
  });

  describe('Agent events', () => {
    it('AgentLaunchedEvent optionally has taskId', () => {
      const event: AgentLaunchedEvent = {
        type: 'agent-launched',
        agent: 'code-writer',
        issueNumber: 5,
        worktreePath: '/tmp/w/issue-5',
      };
      expect(event.taskId).toBeUndefined();
    });

    it('AgentCompletedEvent has exitCode and tokenUsage', () => {
      const event: AgentCompletedEvent = {
        type: 'agent-completed',
        agent: 'code-writer',
        issueNumber: 5,
        exitCode: 0,
        duration: 1200,
        tokenUsage: 500,
      };
      expect(event.exitCode).toBe(0);
    });

    it('AgentFailedEvent has timedOut flag', () => {
      const event: AgentFailedEvent = {
        type: 'agent-failed',
        agent: 'code-writer',
        issueNumber: 5,
        error: 'timed out',
        timedOut: true,
      };
      expect(event.timedOut).toBe(true);
    });
  });

  describe('Task events', () => {
    it('TaskStartedEvent has taskId and taskName', () => {
      const event: TaskStartedEvent = {
        type: 'task-started',
        issueNumber: 2,
        taskId: 'task-1',
        taskName: 'Write tests',
      };
      expect(event.taskName).toBe('Write tests');
    });

    it('TaskCompletedEvent has duration', () => {
      const event: TaskCompletedEvent = {
        type: 'task-completed',
        issueNumber: 2,
        taskId: 'task-1',
        duration: 300,
      };
      expect(event.duration).toBe(300);
    });

    it('TaskBlockedEvent has reason and retryCount', () => {
      const event: TaskBlockedEvent = {
        type: 'task-blocked',
        issueNumber: 2,
        taskId: 'task-1',
        reason: 'waiting for dependency',
        retryCount: 1,
      };
      expect(event.retryCount).toBe(1);
    });

    it('TaskRetryEvent has attempt and maxAttempts', () => {
      const event: TaskRetryEvent = {
        type: 'task-retry',
        issueNumber: 2,
        taskId: 'task-1',
        attempt: 2,
        maxAttempts: 3,
        reason: 'transient failure',
      };
      expect(event.attempt).toBe(2);
    });
  });

  describe('Git events', () => {
    it('GitCommitEvent has sha and message', () => {
      const event: GitCommitEvent = {
        type: 'git-commit',
        issueNumber: 10,
        sha: 'abc123',
        message: 'feat: add login',
      };
      expect(event.sha).toBe('abc123');
    });

    it('GitPushEvent has branch', () => {
      const event: GitPushEvent = {
        type: 'git-push',
        issueNumber: 10,
        branch: 'cadre/issue-10',
      };
      expect(event.branch).toBe('cadre/issue-10');
    });

    it('PRCreatedEvent has prNumber and prUrl', () => {
      const event: PRCreatedEvent = {
        type: 'pr-created',
        issueNumber: 10,
        prNumber: 55,
        prUrl: 'https://github.com/owner/repo/pull/55',
      };
      expect(event.prNumber).toBe(55);
    });
  });

  describe('Budget events', () => {
    it('AmbiguityDetectedEvent lists ambiguities', () => {
      const event: AmbiguityDetectedEvent = {
        type: 'ambiguity-detected',
        issueNumber: 3,
        ambiguities: ['unclear scope', 'missing acceptance criteria'],
      };
      expect(event.ambiguities).toHaveLength(2);
    });

    it('BudgetWarningEvent can be fleet-scoped without issueNumber', () => {
      const event: BudgetWarningEvent = {
        type: 'budget-warning',
        scope: 'fleet',
        currentUsage: 8000,
        budget: 10000,
        percentUsed: 80,
      };
      expect(event.scope).toBe('fleet');
      expect(event.issueNumber).toBeUndefined();
    });

    it('BudgetWarningEvent can be issue-scoped with issueNumber', () => {
      const event: BudgetWarningEvent = {
        type: 'budget-warning',
        scope: 'issue',
        issueNumber: 4,
        currentUsage: 900,
        budget: 1000,
        percentUsed: 90,
      };
      expect(event.issueNumber).toBe(4);
    });

    it('BudgetExceededEvent has scope and usage info', () => {
      const event: BudgetExceededEvent = {
        type: 'budget-exceeded',
        scope: 'fleet',
        currentUsage: 10001,
        budget: 10000,
      };
      expect(event.budget).toBe(10000);
    });
  });

  describe('Isolation events', () => {
    it('IsolationSessionStartedEvent has required fields', () => {
      const event: IsolationSessionStartedEvent = {
        type: 'isolation-session-started',
        providerName: 'host',
        sessionId: 'abc-123',
        policyProfile: 'default',
      };
      expect(event.type).toBe('isolation-session-started');
      expect(event.providerName).toBe('host');
      expect(event.sessionId).toBe('abc-123');
      expect(event.policyProfile).toBe('default');
    });

    it('IsolationSessionEndedEvent has required fields', () => {
      const event: IsolationSessionEndedEvent = {
        type: 'isolation-session-ended',
        providerName: 'docker',
        sessionId: 'xyz-456',
        durationMs: 3200,
        success: true,
      };
      expect(event.type).toBe('isolation-session-ended');
      expect(event.durationMs).toBe(3200);
      expect(event.success).toBe(true);
    });

    it('IsolationCapabilityDowngradeEvent has required fields', () => {
      const event: IsolationCapabilityDowngradeEvent = {
        type: 'isolation-capability-downgrade',
        requestedProvider: 'docker',
        fallbackProvider: 'host',
        reason: 'Docker not available',
      };
      expect(event.type).toBe('isolation-capability-downgrade');
      expect(event.requestedProvider).toBe('docker');
      expect(event.fallbackProvider).toBe('host');
      expect(event.reason).toBe('Docker not available');
    });

    it('isolation events are part of the CadreEvent union', () => {
      const started: CadreEvent = {
        type: 'isolation-session-started',
        providerName: 'host',
        sessionId: 's1',
        policyProfile: 'default',
      };
      const ended: CadreEvent = {
        type: 'isolation-session-ended',
        providerName: 'host',
        sessionId: 's1',
        durationMs: 100,
        success: false,
      };
      const downgrade: CadreEvent = {
        type: 'isolation-capability-downgrade',
        requestedProvider: 'docker',
        fallbackProvider: 'host',
        reason: 'unsupported',
      };
      expect(started.type).toBe('isolation-session-started');
      expect(ended.type).toBe('isolation-session-ended');
      expect(downgrade.type).toBe('isolation-capability-downgrade');
    });
  });

  describe('CadreEvent discriminated union narrowing', () => {
    it('narrows to FleetStartedEvent via type discriminant', () => {
      const event: CadreEvent = { type: 'fleet-started', issueCount: 1, maxParallel: 1 };
      const narrowed = narrowEvent(event, 'fleet-started');
      expect(narrowed?.issueCount).toBe(1);
    });

    it('returns null when event type does not match', () => {
      const event: CadreEvent = { type: 'git-push', issueNumber: 1, branch: 'main' };
      const narrowed = narrowEvent(event, 'fleet-started');
      expect(narrowed).toBeNull();
    });

    it('narrows to PRCreatedEvent correctly', () => {
      const event: CadreEvent = {
        type: 'pr-created',
        issueNumber: 5,
        prNumber: 77,
        prUrl: 'https://github.com/x/y/pull/77',
      };
      const narrowed = narrowEvent(event, 'pr-created');
      expect(narrowed?.prNumber).toBe(77);
    });
  });

  describe('LogEntry structure', () => {
    it('is a valid LogEntry with required fields', () => {
      const entry: LogEntry = {
        timestamp: new Date().toISOString(),
        level: 'info',
        source: 'orchestrator',
        message: 'Issue started',
      };
      expect(entry.level).toBe('info');
      expect(entry.issueNumber).toBeUndefined();
    });

    it('supports all LogLevel values', () => {
      const levels: LogLevel[] = ['debug', 'info', 'warn', 'error'];
      for (const level of levels) {
        const entry: LogEntry = {
          timestamp: new Date().toISOString(),
          level,
          source: 'test',
          message: `level ${level}`,
        };
        expect(entry.level).toBe(level);
      }
    });

    it('accepts optional fields without errors', () => {
      const entry: LogEntry = {
        timestamp: '2024-01-01T00:00:00Z',
        level: 'debug',
        source: 'worker',
        issueNumber: 99,
        phase: 3,
        taskId: 'task-xyz',
        message: 'granular debug',
        data: { key: 'value' },
      };
      expect(entry.taskId).toBe('task-xyz');
      expect(entry.data).toEqual({ key: 'value' });
    });
  });
});
