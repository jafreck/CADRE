import { describe, it, expect } from 'vitest';
import type { RunIssueSummary, RunPhaseSummary, RunTotals, RunReport } from '../src/reporting/types.js';

describe('RunIssueSummary', () => {
  it('should accept a minimal valid RunIssueSummary', () => {
    const summary: RunIssueSummary = {
      issueNumber: 42,
      issueTitle: 'Fix the bug',
      success: true,
      tokens: 1000,
      duration: 5000,
    };
    expect(summary.issueNumber).toBe(42);
    expect(summary.issueTitle).toBe('Fix the bug');
    expect(summary.success).toBe(true);
    expect(summary.tokens).toBe(1000);
    expect(summary.duration).toBe(5000);
    expect(summary.prNumber).toBeUndefined();
    expect(summary.error).toBeUndefined();
  });

  it('should accept RunIssueSummary with optional prNumber', () => {
    const summary: RunIssueSummary = {
      issueNumber: 7,
      issueTitle: 'Add feature',
      success: true,
      prNumber: 99,
      tokens: 500,
      duration: 3000,
    };
    expect(summary.prNumber).toBe(99);
  });

  it('should accept RunIssueSummary with optional error', () => {
    const summary: RunIssueSummary = {
      issueNumber: 3,
      issueTitle: 'Broken issue',
      success: false,
      tokens: 200,
      duration: 1000,
      error: 'Agent timed out',
    };
    expect(summary.success).toBe(false);
    expect(summary.error).toBe('Agent timed out');
  });

  it('should accept zero values for numeric fields', () => {
    const summary: RunIssueSummary = {
      issueNumber: 1,
      issueTitle: 'Empty run',
      success: true,
      tokens: 0,
      duration: 0,
    };
    expect(summary.tokens).toBe(0);
    expect(summary.duration).toBe(0);
  });
});

describe('RunPhaseSummary', () => {
  it('should accept a valid RunPhaseSummary', () => {
    const phase: RunPhaseSummary = {
      id: 'phase-1',
      name: 'Analysis',
      duration: 2000,
      tokens: 300,
      estimatedCost: 0.015,
    };
    expect(phase.id).toBe('phase-1');
    expect(phase.name).toBe('Analysis');
    expect(phase.duration).toBe(2000);
    expect(phase.tokens).toBe(300);
    expect(phase.estimatedCost).toBe(0.015);
  });

  it('should accept zero cost for RunPhaseSummary', () => {
    const phase: RunPhaseSummary = {
      id: 'phase-0',
      name: 'Setup',
      duration: 100,
      tokens: 0,
      estimatedCost: 0,
    };
    expect(phase.estimatedCost).toBe(0);
  });
});

describe('RunTotals', () => {
  it('should accept a valid RunTotals', () => {
    const totals: RunTotals = {
      tokens: 10000,
      estimatedCost: 0.5,
      issues: 5,
      prsCreated: 4,
      failures: 1,
    };
    expect(totals.tokens).toBe(10000);
    expect(totals.estimatedCost).toBe(0.5);
    expect(totals.issues).toBe(5);
    expect(totals.prsCreated).toBe(4);
    expect(totals.failures).toBe(1);
  });

  it('should accept all-zero RunTotals', () => {
    const totals: RunTotals = {
      tokens: 0,
      estimatedCost: 0,
      issues: 0,
      prsCreated: 0,
      failures: 0,
    };
    expect(totals.failures).toBe(0);
  });
});

describe('RunReport', () => {
  const baseTotals: RunTotals = {
    tokens: 5000,
    estimatedCost: 0.25,
    issues: 2,
    prsCreated: 2,
    failures: 0,
  };

  const baseIssue: RunIssueSummary = {
    issueNumber: 1,
    issueTitle: 'First issue',
    success: true,
    prNumber: 10,
    tokens: 2500,
    duration: 30000,
  };

  const basePhase: RunPhaseSummary = {
    id: 'analysis',
    name: 'Analysis',
    duration: 15000,
    tokens: 1000,
    estimatedCost: 0.05,
  };

  it('should accept a valid RunReport', () => {
    const report: RunReport = {
      runId: 'run-abc-123',
      project: 'my-project',
      startTime: '2024-01-01T00:00:00.000Z',
      endTime: '2024-01-01T01:00:00.000Z',
      duration: 3600000,
      issues: [baseIssue],
      phases: [basePhase],
      totalTokens: 5000,
      estimatedCost: 0.25,
      prsCreated: 2,
      agentInvocations: 10,
      retries: 1,
      totals: baseTotals,
    };
    expect(report.runId).toBe('run-abc-123');
    expect(report.project).toBe('my-project');
    expect(report.startTime).toBe('2024-01-01T00:00:00.000Z');
    expect(report.endTime).toBe('2024-01-01T01:00:00.000Z');
    expect(report.duration).toBe(3600000);
    expect(report.issues).toHaveLength(1);
    expect(report.phases).toHaveLength(1);
    expect(report.totalTokens).toBe(5000);
    expect(report.estimatedCost).toBe(0.25);
    expect(report.prsCreated).toBe(2);
    expect(report.agentInvocations).toBe(10);
    expect(report.retries).toBe(1);
    expect(report.totals).toEqual(baseTotals);
  });

  it('should accept a RunReport with empty issues and phases arrays', () => {
    const report: RunReport = {
      runId: 'run-empty',
      project: 'empty-project',
      startTime: '2024-06-01T00:00:00.000Z',
      endTime: '2024-06-01T00:00:01.000Z',
      duration: 1000,
      issues: [],
      phases: [],
      totalTokens: 0,
      estimatedCost: 0,
      prsCreated: 0,
      agentInvocations: 0,
      retries: 0,
      totals: {
        tokens: 0,
        estimatedCost: 0,
        issues: 0,
        prsCreated: 0,
        failures: 0,
      },
    };
    expect(report.issues).toEqual([]);
    expect(report.phases).toEqual([]);
    expect(report.totalTokens).toBe(0);
  });

  it('should accept a RunReport with multiple issues including failed ones', () => {
    const failedIssue: RunIssueSummary = {
      issueNumber: 99,
      issueTitle: 'Failing issue',
      success: false,
      tokens: 100,
      duration: 500,
      error: 'Timeout exceeded',
    };
    const report: RunReport = {
      runId: 'run-mixed',
      project: 'test',
      startTime: '2024-01-01T00:00:00.000Z',
      endTime: '2024-01-01T00:30:00.000Z',
      duration: 1800000,
      issues: [baseIssue, failedIssue],
      phases: [basePhase],
      totalTokens: 2600,
      estimatedCost: 0.13,
      prsCreated: 1,
      agentInvocations: 5,
      retries: 2,
      totals: { tokens: 2600, estimatedCost: 0.13, issues: 2, prsCreated: 1, failures: 1 },
    };
    expect(report.issues).toHaveLength(2);
    expect(report.issues[1].success).toBe(false);
    expect(report.issues[1].error).toBe('Timeout exceeded');
    expect(report.totals.failures).toBe(1);
  });
});
