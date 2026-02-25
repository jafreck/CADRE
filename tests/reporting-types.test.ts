import { describe, it, expect } from 'vitest';
import type { RunIssueSummary, RunPhaseSummary, RunTotals, RunReport, CostReport, CostReportAgentEntry, CostReportPhaseEntry } from '../src/reporting/types.js';

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

  it('should accept RunIssueSummary with optional wave field', () => {
    const summary: RunIssueSummary = {
      issueNumber: 5,
      issueTitle: 'Wave issue',
      success: true,
      tokens: 800,
      duration: 4000,
      wave: 2,
    };
    expect(summary.wave).toBe(2);
  });

  it('wave field should be undefined when not provided', () => {
    const summary: RunIssueSummary = {
      issueNumber: 6,
      issueTitle: 'No wave',
      success: true,
      tokens: 100,
      duration: 1000,
    };
    expect(summary.wave).toBeUndefined();
  });

  it('should accept wave 0 as a valid wave number', () => {
    const summary: RunIssueSummary = {
      issueNumber: 7,
      issueTitle: 'First wave',
      success: true,
      tokens: 500,
      duration: 2000,
      wave: 0,
    };
    expect(summary.wave).toBe(0);
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
      totals: { tokens: 2600, estimatedCost: 0.13, issues: 2, prsCreated: 1, failures: 1 },
    };
    expect(report.issues).toHaveLength(2);
    expect(report.issues[1].success).toBe(false);
    expect(report.issues[1].error).toBe('Timeout exceeded');
    expect(report.totals.failures).toBe(1);
  });
});

describe('CostReportAgentEntry', () => {
  it('should accept a valid CostReportAgentEntry', () => {
    const entry: CostReportAgentEntry = {
      agent: 'code-writer',
      tokens: 2000,
      inputTokens: 1500,
      outputTokens: 500,
      estimatedCost: 0.04,
    };
    expect(entry.agent).toBe('code-writer');
    expect(entry.tokens).toBe(2000);
    expect(entry.inputTokens).toBe(1500);
    expect(entry.outputTokens).toBe(500);
    expect(entry.estimatedCost).toBe(0.04);
  });

  it('should accept zero token values for CostReportAgentEntry', () => {
    const entry: CostReportAgentEntry = {
      agent: 'idle-agent',
      tokens: 0,
      inputTokens: 0,
      outputTokens: 0,
      estimatedCost: 0,
    };
    expect(entry.tokens).toBe(0);
    expect(entry.estimatedCost).toBe(0);
  });

  it('should accept inputTokens + outputTokens summing to tokens', () => {
    const entry: CostReportAgentEntry = {
      agent: 'test-writer',
      tokens: 300,
      inputTokens: 200,
      outputTokens: 100,
      estimatedCost: 0.006,
    };
    expect(entry.inputTokens + entry.outputTokens).toBe(entry.tokens);
  });
});

describe('CostReportPhaseEntry', () => {
  it('should accept a valid CostReportPhaseEntry', () => {
    const entry: CostReportPhaseEntry = {
      phase: 1,
      phaseName: 'Analysis',
      tokens: 500,
      estimatedCost: 0.01,
    };
    expect(entry.phase).toBe(1);
    expect(entry.phaseName).toBe('Analysis');
    expect(entry.tokens).toBe(500);
    expect(entry.estimatedCost).toBe(0.01);
  });

  it('should accept zero values for CostReportPhaseEntry', () => {
    const entry: CostReportPhaseEntry = {
      phase: 0,
      phaseName: 'Setup',
      tokens: 0,
      estimatedCost: 0,
    };
    expect(entry.tokens).toBe(0);
    expect(entry.estimatedCost).toBe(0);
  });
});

describe('CostReport', () => {
  const agentEntry: CostReportAgentEntry = {
    agent: 'code-writer',
    tokens: 1200,
    inputTokens: 900,
    outputTokens: 300,
    estimatedCost: 0.024,
  };

  const phaseEntry: CostReportPhaseEntry = {
    phase: 2,
    phaseName: 'Implementation',
    tokens: 1200,
    estimatedCost: 0.024,
  };

  it('should accept a valid CostReport', () => {
    const report: CostReport = {
      issueNumber: 42,
      generatedAt: '2024-06-01T12:00:00.000Z',
      totalTokens: 1200,
      inputTokens: 900,
      outputTokens: 300,
      estimatedCost: 0.024,
      model: 'claude-3-5-sonnet',
      byAgent: [agentEntry],
      byPhase: [phaseEntry],
    };
    expect(report.issueNumber).toBe(42);
    expect(report.generatedAt).toBe('2024-06-01T12:00:00.000Z');
    expect(report.totalTokens).toBe(1200);
    expect(report.inputTokens).toBe(900);
    expect(report.outputTokens).toBe(300);
    expect(report.estimatedCost).toBe(0.024);
    expect(report.model).toBe('claude-3-5-sonnet');
    expect(report.byAgent).toHaveLength(1);
    expect(report.byPhase).toHaveLength(1);
  });

  it('should accept a CostReport with empty byAgent and byPhase arrays', () => {
    const report: CostReport = {
      issueNumber: 1,
      generatedAt: '2024-01-01T00:00:00.000Z',
      totalTokens: 0,
      inputTokens: 0,
      outputTokens: 0,
      estimatedCost: 0,
      model: 'gpt-4',
      byAgent: [],
      byPhase: [],
    };
    expect(report.byAgent).toEqual([]);
    expect(report.byPhase).toEqual([]);
    expect(report.totalTokens).toBe(0);
  });

  it('should accept a CostReport with multiple agent and phase entries', () => {
    const secondAgent: CostReportAgentEntry = {
      agent: 'test-writer',
      tokens: 800,
      inputTokens: 600,
      outputTokens: 200,
      estimatedCost: 0.016,
    };
    const secondPhase: CostReportPhaseEntry = {
      phase: 3,
      phaseName: 'Testing',
      tokens: 800,
      estimatedCost: 0.016,
    };
    const report: CostReport = {
      issueNumber: 7,
      generatedAt: '2024-03-15T08:30:00.000Z',
      totalTokens: 2000,
      inputTokens: 1500,
      outputTokens: 500,
      estimatedCost: 0.04,
      model: 'claude-3-5-sonnet',
      byAgent: [agentEntry, secondAgent],
      byPhase: [phaseEntry, secondPhase],
    };
    expect(report.byAgent).toHaveLength(2);
    expect(report.byPhase).toHaveLength(2);
    expect(report.byAgent[1].agent).toBe('test-writer');
    expect(report.byPhase[1].phaseName).toBe('Testing');
  });

  it('should store generatedAt as an ISO string', () => {
    const isoDate = '2024-12-31T23:59:59.999Z';
    const report: CostReport = {
      issueNumber: 100,
      generatedAt: isoDate,
      totalTokens: 50,
      inputTokens: 30,
      outputTokens: 20,
      estimatedCost: 0.001,
      model: 'gpt-4o',
      byAgent: [],
      byPhase: [],
    };
    expect(report.generatedAt).toBe(isoDate);
    expect(() => new Date(report.generatedAt)).not.toThrow();
  });
});
