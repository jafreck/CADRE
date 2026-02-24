import { describe, it, expect } from 'vitest';
import type { FleetResult } from '../src/core/fleet-orchestrator.js';
import type { TokenSummary } from '../src/budget/token-tracker.js';
import { CadreRuntime } from '../src/core/runtime.js';
import { CadreConfigSchema } from '../src/config/schema.js';

const minimalConfig = CadreConfigSchema.parse({
  projectName: 'test-project',
  repository: 'owner/repo',
  repoPath: '/tmp/test-repo',
  stateDir: '/tmp/cadre-state',
  baseBranch: 'main',
  issues: { ids: [1] },
  github: {
    auth: { token: 'test-token' },
  },
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
