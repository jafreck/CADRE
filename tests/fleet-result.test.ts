import { describe, it, expect } from 'vitest';
import type { FleetResult } from '../src/core/fleet-orchestrator.js';
import type { TokenSummary } from '../src/budget/token-tracker.js';
import type { PullRequestInfo } from '../src/platform/provider.js';
import { CadreRuntime } from '../src/core/runtime.js';
import { CadreConfigSchema } from '../src/config/schema.js';

const emptyTokenUsage: TokenSummary = {
  total: 0,
  byIssue: {},
  byAgent: {},
  byPhase: {},
  recordCount: 0,
};

const minimalConfig = CadreConfigSchema.parse({
  projectName: 'test-project',
  repository: 'owner/repo',
  repoPath: '/tmp/test-repo',
  baseBranch: 'main',
  issues: { ids: [1] },
  github: {
    auth: { token: 'test-token' },
  },
});

describe('FleetResult.prsCreated', () => {
  it('should accept an array of PullRequestInfo objects', () => {
    const pr1: PullRequestInfo = {
      number: 10,
      url: 'https://github.com/owner/repo/pull/10',
      title: 'Fix issue #1',
      headBranch: 'cadre/issue-1',
      baseBranch: 'main',
    };
    const pr2: PullRequestInfo = {
      number: 11,
      url: 'https://github.com/owner/repo/pull/11',
      title: 'Fix issue #2',
      headBranch: 'cadre/issue-2',
      baseBranch: 'main',
    };
    const result: FleetResult = {
      success: true,
      issues: [],
      prsCreated: [pr1, pr2],
      codeDoneNoPR: [],
      failedIssues: [],
      totalDuration: 2000,
      tokenUsage: emptyTokenUsage,
    };
    expect(result.prsCreated).toHaveLength(2);
    expect(result.prsCreated[0]).toEqual(pr1);
    expect(result.prsCreated[1]).toEqual(pr2);
  });

  it('should store the PR url in the PullRequestInfo url field', () => {
    const prUrl = 'https://github.com/owner/repo/pull/42';
    const pr: PullRequestInfo = {
      number: 42,
      url: prUrl,
      title: 'Fix issue #5',
      headBranch: 'cadre/issue-5',
      baseBranch: 'main',
    };
    const result: FleetResult = {
      success: true,
      issues: [],
      prsCreated: [pr],
      codeDoneNoPR: [],
      failedIssues: [],
      totalDuration: 500,
      tokenUsage: emptyTokenUsage,
    };
    expect(result.prsCreated[0].url).toBe(prUrl);
    expect(result.prsCreated[0].number).toBe(42);
  });

  it('should accept an empty prsCreated array when no PRs were opened', () => {
    const result: FleetResult = {
      success: true,
      issues: [],
      prsCreated: [],
      codeDoneNoPR: [],
      failedIssues: [],
      totalDuration: 0,
      tokenUsage: emptyTokenUsage,
    };
    expect(result.prsCreated).toEqual([]);
  });
});

describe('FleetResult.codeDoneNoPR', () => {
  it('should accept an array of codeDoneNoPR entries', () => {
    const result: FleetResult = {
      success: true,
      issues: [],
      prsCreated: [],
      codeDoneNoPR: [
        { issueNumber: 5, issueTitle: 'Fix the thing' },
        { issueNumber: 7, issueTitle: 'Another fix' },
      ],
      failedIssues: [],
      totalDuration: 1000,
      tokenUsage: emptyTokenUsage,
    };
    expect(result.codeDoneNoPR).toHaveLength(2);
    expect(result.codeDoneNoPR[0]).toEqual({ issueNumber: 5, issueTitle: 'Fix the thing' });
    expect(result.codeDoneNoPR[1]).toEqual({ issueNumber: 7, issueTitle: 'Another fix' });
  });

  it('should accept an empty codeDoneNoPR array', () => {
    const result: FleetResult = {
      success: true,
      issues: [],
      prsCreated: [],
      codeDoneNoPR: [],
      failedIssues: [],
      totalDuration: 0,
      tokenUsage: emptyTokenUsage,
    };
    expect(result.codeDoneNoPR).toEqual([]);
  });
});

describe('FleetResult.tokenUsage', () => {
  it('should accept a TokenSummary with byPhase and recordCount', () => {
    const tokenSummary: TokenSummary = {
      total: 8000,
      byIssue: { 42: 8000 },
      byAgent: { 'code-writer': 8000 },
      byPhase: { 3: 8000 },
      recordCount: 2,
    };
    const result: FleetResult = {
      success: true,
      issues: [],
      prsCreated: [],
      failedIssues: [],
      totalDuration: 5000,
      tokenUsage: tokenSummary,
    };
    expect(result.tokenUsage.byPhase).toEqual({ 3: 8000 });
    expect(result.tokenUsage.recordCount).toBe(2);
    expect(result.tokenUsage.total).toBe(8000);
  });

  it('should accept an empty TokenSummary with zero values', () => {
    const emptyTokenUsage: TokenSummary = {
      total: 0,
      byIssue: {},
      byAgent: {},
      byPhase: {},
      recordCount: 0,
    };
    const result: FleetResult = {
      success: true,
      issues: [],
      prsCreated: [],
      failedIssues: [],
      totalDuration: 0,
      tokenUsage: emptyTokenUsage,
    };
    expect(result.tokenUsage.byPhase).toEqual({});
    expect(result.tokenUsage.recordCount).toBe(0);
    expect(result.tokenUsage.total).toBe(0);
  });
});

describe('CadreRuntime.emptyResult()', () => {
  it('should return a FleetResult with a complete TokenSummary including byPhase and recordCount', () => {
    const runtime = new CadreRuntime(minimalConfig);
    const result = (runtime as unknown as { emptyResult(): FleetResult }).emptyResult();

    expect(result.success).toBe(true);
    expect(result.issues).toEqual([]);
    expect(result.prsCreated).toEqual([]);
    expect(result.failedIssues).toEqual([]);
    expect(result.totalDuration).toBe(0);
    expect(result.tokenUsage).toMatchObject({
      total: 0,
      byIssue: {},
      byAgent: {},
      byPhase: {},
      recordCount: 0,
    });
  });

  it('should return tokenUsage with byPhase as an empty object (not undefined)', () => {
    const runtime = new CadreRuntime(minimalConfig);
    const result = (runtime as unknown as { emptyResult(): FleetResult }).emptyResult();

    expect(result.tokenUsage.byPhase).toBeDefined();
    expect(typeof result.tokenUsage.byPhase).toBe('object');
  });

  it('should return tokenUsage with recordCount of 0 (not undefined)', () => {
    const runtime = new CadreRuntime(minimalConfig);
    const result = (runtime as unknown as { emptyResult(): FleetResult }).emptyResult();

    expect(result.tokenUsage.recordCount).toBeDefined();
    expect(result.tokenUsage.recordCount).toBe(0);
  });
});
