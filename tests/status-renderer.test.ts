import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { formatElapsed, renderFleetStatus, renderIssueDetail } from '../src/cli/status-renderer.js';
import type { FleetCheckpointState, FleetIssueStatus, CheckpointState } from '../src/core/checkpoint.js';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeFleetState(overrides: Partial<FleetCheckpointState> = {}): FleetCheckpointState {
  return {
    projectName: 'test-project',
    version: 1,
    issues: {},
    tokenUsage: { total: 0, byIssue: {} },
    startedAt: new Date().toISOString(),
    lastCheckpoint: new Date().toISOString(),
    resumeCount: 0,
    ...overrides,
  };
}

function makeIssueStatus(overrides: Partial<FleetIssueStatus> = {}): FleetIssueStatus {
  return {
    status: 'not-started',
    issueTitle: 'Test Issue',
    worktreePath: '/repo/worktrees/issue-1',
    branchName: 'issue-1',
    lastPhase: 1,
    ...overrides,
  };
}

function makeCheckpointState(overrides: Partial<CheckpointState> = {}): CheckpointState {
  return {
    issueNumber: 1,
    version: 1,
    currentPhase: 1,
    currentTask: null,
    completedPhases: [],
    completedTasks: [],
    failedTasks: [],
    blockedTasks: [],
    phaseOutputs: {},
    tokenUsage: { total: 0, byPhase: {}, byAgent: {} },
    worktreePath: '/repo/worktrees/issue-1',
    branchName: 'issue-1',
    baseCommit: 'abc123',
    startedAt: new Date().toISOString(),
    lastCheckpoint: new Date().toISOString(),
    resumeCount: 0,
    ...overrides,
  };
}

// ─── formatElapsed ────────────────────────────────────────────────────────────

describe('formatElapsed', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2024-01-01T12:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('should return "—" for undefined input', () => {
    expect(formatElapsed(undefined)).toBe('—');
  });

  it('should return "—" for an invalid date string', () => {
    expect(formatElapsed('not-a-date')).toBe('—');
  });

  it('should return "—" for a future date', () => {
    const future = new Date('2024-01-01T13:00:00Z').toISOString();
    expect(formatElapsed(future)).toBe('—');
  });

  it('should return minutes ago for elapsed < 60 minutes', () => {
    const fiveMinAgo = new Date('2024-01-01T11:55:00Z').toISOString();
    expect(formatElapsed(fiveMinAgo)).toBe('5m ago');
  });

  it('should return "just now" for very recent timestamps (0ms)', () => {
    const justNow = new Date('2024-01-01T12:00:00Z').toISOString();
    expect(formatElapsed(justNow)).toBe('just now');
  });

  it('should return "just now" for timestamps 30 seconds ago', () => {
    const thirtySecondsAgo = new Date('2024-01-01T11:59:30Z').toISOString();
    expect(formatElapsed(thirtySecondsAgo)).toBe('just now');
  });

  it('should return "just now" for timestamps 59 seconds ago', () => {
    const fiftyNineSecondsAgo = new Date('2024-01-01T11:59:01Z').toISOString();
    expect(formatElapsed(fiftyNineSecondsAgo)).toBe('just now');
  });

  it('should return "1m ago" for timestamps exactly 60 seconds ago', () => {
    const sixtySecondsAgo = new Date('2024-01-01T11:59:00Z').toISOString();
    expect(formatElapsed(sixtySecondsAgo)).toBe('1m ago');
  });

  it('should return hours ago for elapsed >= 60 minutes and < 24 hours', () => {
    const twoHoursAgo = new Date('2024-01-01T10:00:00Z').toISOString();
    expect(formatElapsed(twoHoursAgo)).toBe('2h ago');
  });

  it('should return days ago for elapsed >= 24 hours', () => {
    const threeDaysAgo = new Date('2023-12-29T12:00:00Z').toISOString();
    expect(formatElapsed(threeDaysAgo)).toBe('3d ago');
  });
});

// ─── renderFleetStatus ────────────────────────────────────────────────────────

describe('renderFleetStatus', () => {
  it('should include the project name in the header', () => {
    const state = makeFleetState({ projectName: 'my-project' });
    const output = renderFleetStatus(state);
    expect(output).toContain('my-project');
  });

  it('should include header columns: Issue, Title, Status, Phase, Tokens, Cost, Branch, Updated', () => {
    const state = makeFleetState();
    const output = renderFleetStatus(state);
    expect(output).toContain('Issue');
    expect(output).toContain('Title');
    expect(output).toContain('Status');
    expect(output).toContain('Phase');
    expect(output).toContain('Tokens');
    expect(output).toContain('Cost');
    expect(output).toContain('Branch');
    expect(output).toContain('Updated');
  });

  it('should include one row per issue with issue number and title', () => {
    const state = makeFleetState({
      issues: {
        42: makeIssueStatus({ issueTitle: 'Fix the bug', branchName: 'issue-42' }),
      },
    });
    const output = renderFleetStatus(state);
    expect(output).toContain('#42');
    expect(output).toContain('Fix the bug');
  });

  it('should show the correct status emoji for each status', () => {
    const statuses: Array<FleetIssueStatus['status']> = [
      'not-started', 'in-progress', 'completed', 'failed', 'blocked', 'budget-exceeded', 'code-complete-no-pr',
    ];
    const emojis: Record<string, string> = {
      'not-started': '⏳',
      'in-progress': '🔄',
      completed: '✅',
      failed: '❌',
      blocked: '🚫',
      'budget-exceeded': '💸',
      'code-complete-no-pr': '🔀',
    };
    for (const status of statuses) {
      const state = makeFleetState({
        issues: { 1: makeIssueStatus({ status }) },
      });
      const output = renderFleetStatus(state);
      expect(output).toContain(emojis[status]);
    }
  });

  it('should show human-readable phase name (not just phase number)', () => {
    const state = makeFleetState({
      issues: {
        1: makeIssueStatus({ lastPhase: 3 }), // Implementation
      },
    });
    const output = renderFleetStatus(state);
    expect(output).toContain('Implementation');
  });

  it('should show token count for issues with tokens', () => {
    const state = makeFleetState({
      issues: { 7: makeIssueStatus({ issueTitle: 'Token test' }) },
      tokenUsage: { total: 5000, byIssue: { 7: 5000 } },
    });
    const output = renderFleetStatus(state);
    expect(output).toContain('5,000');
  });

  it('should show "—" for cost when token count is 0', () => {
    const state = makeFleetState({
      issues: { 1: makeIssueStatus() },
      tokenUsage: { total: 0, byIssue: { 1: 0 } },
    });
    const output = renderFleetStatus(state);
    expect(output).toContain('—');
  });

  it('should show "—" for branch when branchName is empty', () => {
    const state = makeFleetState({
      issues: { 1: makeIssueStatus({ branchName: '' }) },
    });
    const output = renderFleetStatus(state);
    expect(output).toContain('—');
  });

  it('should include total token usage in the header', () => {
    const state = makeFleetState({
      tokenUsage: { total: 12000, byIssue: {} },
    });
    const output = renderFleetStatus(state);
    expect(output).toContain('12,000');
  });

  it('should include estimated cost in the header', () => {
    const state = makeFleetState({
      tokenUsage: { total: 10000, byIssue: {} },
    });
    const output = renderFleetStatus(state);
    expect(output).toContain('Estimated Cost');
    expect(output).toContain('$');
  });

  it('should handle multiple issues and produce multiple rows', () => {
    const state = makeFleetState({
      issues: {
        10: makeIssueStatus({ issueTitle: 'Issue Ten' }),
        20: makeIssueStatus({ issueTitle: 'Issue Twenty' }),
      },
    });
    const output = renderFleetStatus(state);
    expect(output).toContain('#10');
    expect(output).toContain('Issue Ten');
    expect(output).toContain('#20');
    expect(output).toContain('Issue Twenty');
  });
});

// ─── renderIssueDetail ────────────────────────────────────────────────────────

describe('renderIssueDetail', () => {
  it('should include the issue number and title in the output', () => {
    const issueStatus = makeIssueStatus({ issueTitle: 'My Feature' });
    const checkpoint = makeCheckpointState({ issueNumber: 5 });
    const output = renderIssueDetail(5, issueStatus, checkpoint);
    expect(output).toContain('Issue #5');
    expect(output).toContain('My Feature');
  });

  it('should include all 5 phase names', () => {
    const issueStatus = makeIssueStatus();
    const checkpoint = makeCheckpointState();
    const output = renderIssueDetail(1, issueStatus, checkpoint);
    expect(output).toContain('Analysis & Scouting');
    expect(output).toContain('Planning');
    expect(output).toContain('Implementation');
    expect(output).toContain('Integration Verification');
    expect(output).toContain('PR Composition');
  });

  it('should show ✅ for completed phases', () => {
    const issueStatus = makeIssueStatus();
    const checkpoint = makeCheckpointState({ completedPhases: [1, 2] });
    const output = renderIssueDetail(1, issueStatus, checkpoint);
    expect(output).toContain('✅');
  });

  it('should show 🔄 for the current phase', () => {
    const issueStatus = makeIssueStatus();
    const checkpoint = makeCheckpointState({ currentPhase: 3, completedPhases: [1, 2] });
    const output = renderIssueDetail(1, issueStatus, checkpoint);
    expect(output).toContain('🔄');
  });

  it('should show ⏳ for phases not yet started', () => {
    const issueStatus = makeIssueStatus();
    const checkpoint = makeCheckpointState({ currentPhase: 1, completedPhases: [] });
    const output = renderIssueDetail(1, issueStatus, checkpoint);
    // Phases 2-5 should be ⏳
    expect(output).toContain('⏳');
  });

  it('should include token count for phases with tokens', () => {
    const issueStatus = makeIssueStatus();
    const checkpoint = makeCheckpointState({
      tokenUsage: { total: 3000, byPhase: { 1: 3000 }, byAgent: {} },
    });
    const output = renderIssueDetail(1, issueStatus, checkpoint);
    expect(output).toContain('3,000');
  });

  it('should show "—" for phases with no token data', () => {
    const issueStatus = makeIssueStatus();
    const checkpoint = makeCheckpointState({
      tokenUsage: { total: 0, byPhase: {}, byAgent: {} },
    });
    const output = renderIssueDetail(1, issueStatus, checkpoint);
    expect(output).toContain('—');
  });

  it('should include gate results section when gateResults are present', () => {
    const issueStatus = makeIssueStatus();
    const checkpoint = makeCheckpointState({
      gateResults: {
        1: { status: 'pass', errors: [], warnings: [] },
      },
    });
    const output = renderIssueDetail(1, issueStatus, checkpoint, true);
    expect(output).toContain('Gate Results');
    expect(output).toContain('✅');
  });

  it('should show ⚠️ for warn gate results', () => {
    const issueStatus = makeIssueStatus();
    const checkpoint = makeCheckpointState({
      gateResults: {
        2: { status: 'warn', errors: [], warnings: ['low coverage'] },
      },
    });
    const output = renderIssueDetail(1, issueStatus, checkpoint, true);
    expect(output).toContain('warn');
    expect(output).toContain('low coverage');
  });

  it('should show ❌ for fail gate results and list errors', () => {
    const issueStatus = makeIssueStatus();
    const checkpoint = makeCheckpointState({
      gateResults: {
        3: { status: 'fail', errors: ['build failed'], warnings: [] },
      },
    });
    const output = renderIssueDetail(1, issueStatus, checkpoint, true);
    expect(output).toContain('fail');
    expect(output).toContain('build failed');
  });

  it('should not include gate results section when gateResults is undefined', () => {
    const issueStatus = makeIssueStatus();
    const checkpoint = makeCheckpointState({ gateResults: undefined });
    const output = renderIssueDetail(1, issueStatus, checkpoint);
    expect(output).not.toContain('Gate Results');
  });

  it('should include phase names next to gate phase numbers', () => {
    const issueStatus = makeIssueStatus();
    const checkpoint = makeCheckpointState({
      gateResults: {
        2: { status: 'pass', errors: [], warnings: [] },
      },
    });
    const output = renderIssueDetail(1, issueStatus, checkpoint, true);
    expect(output).toContain('Planning');
  });
});
