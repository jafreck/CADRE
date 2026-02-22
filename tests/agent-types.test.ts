import { describe, it, expect } from 'vitest';
import type { AgentResult, PhaseResult } from '../src/agents/types.js';
import type { IssueResult } from '../src/core/issue-orchestrator.js';

describe('AgentResult.tokenUsage', () => {
  it('should accept null for tokenUsage', () => {
    const result: AgentResult = {
      agent: 'code-writer',
      success: true,
      exitCode: 0,
      timedOut: false,
      duration: 1000,
      stdout: '',
      stderr: '',
      tokenUsage: null,
      outputPath: '/tmp/output',
      outputExists: true,
    };
    expect(result.tokenUsage).toBeNull();
  });

  it('should accept a number for tokenUsage', () => {
    const result: AgentResult = {
      agent: 'code-writer',
      success: true,
      exitCode: 0,
      timedOut: false,
      duration: 1000,
      stdout: '',
      stderr: '',
      tokenUsage: 4200,
      outputPath: '/tmp/output',
      outputExists: true,
    };
    expect(result.tokenUsage).toBe(4200);
  });

  it('should accept zero for tokenUsage', () => {
    const result: AgentResult = {
      agent: 'issue-analyst',
      success: false,
      exitCode: 1,
      timedOut: false,
      duration: 500,
      stdout: '',
      stderr: 'error',
      tokenUsage: 0,
      outputPath: '/tmp/output',
      outputExists: false,
    };
    expect(result.tokenUsage).toBe(0);
  });
});

describe('PhaseResult.tokenUsage', () => {
  it('should accept null for tokenUsage', () => {
    const result: PhaseResult = {
      phase: 1,
      phaseName: 'Analysis & Scouting',
      success: true,
      duration: 5000,
      tokenUsage: null,
    };
    expect(result.tokenUsage).toBeNull();
  });

  it('should accept a number for tokenUsage', () => {
    const result: PhaseResult = {
      phase: 2,
      phaseName: 'Planning',
      success: true,
      duration: 3000,
      tokenUsage: 7500,
    };
    expect(result.tokenUsage).toBe(7500);
  });

  it('should accept null with optional fields unset', () => {
    const result: PhaseResult = {
      phase: 3,
      phaseName: 'Implementation',
      success: false,
      duration: 0,
      tokenUsage: null,
      error: 'Agent timed out',
    };
    expect(result.tokenUsage).toBeNull();
    expect(result.error).toBe('Agent timed out');
    expect(result.outputPath).toBeUndefined();
  });
});

describe('IssueResult.tokenUsage', () => {
  it('should accept null for tokenUsage', () => {
    const result: IssueResult = {
      issueNumber: 14,
      issueTitle: 'Fix tokenUsage type',
      success: true,
      phases: [],
      totalDuration: 10000,
      tokenUsage: null,
    };
    expect(result.tokenUsage).toBeNull();
  });

  it('should accept a number for tokenUsage', () => {
    const result: IssueResult = {
      issueNumber: 14,
      issueTitle: 'Fix tokenUsage type',
      success: true,
      phases: [],
      totalDuration: 10000,
      tokenUsage: 15000,
    };
    expect(result.tokenUsage).toBe(15000);
  });

  it('should carry tokenUsage from phases', () => {
    const phase: PhaseResult = {
      phase: 1,
      phaseName: 'Analysis & Scouting',
      success: true,
      duration: 2000,
      tokenUsage: null,
    };
    const result: IssueResult = {
      issueNumber: 14,
      issueTitle: 'Fix tokenUsage type',
      success: true,
      phases: [phase],
      totalDuration: 2000,
      tokenUsage: null,
    };
    expect(result.phases[0].tokenUsage).toBeNull();
    expect(result.tokenUsage).toBeNull();
  });
});
