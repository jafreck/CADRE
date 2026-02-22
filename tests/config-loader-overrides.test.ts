import { describe, it, expect } from 'vitest';
import { applyOverrides } from '../src/config/loader.js';
import type { CadreConfig } from '../src/config/schema.js';

const baseConfig: CadreConfig = {
  projectName: 'test-project',
  platform: 'github',
  repository: 'owner/repo',
  repoPath: '/tmp/repo',
  baseBranch: 'main',
  worktreeRoot: undefined,
  issues: { ids: [1] },
  branchTemplate: 'cadre/issue-{issue}',
  commits: { conventional: true, sign: false, commitPerPhase: true, squashBeforePR: false },
  pullRequest: { autoCreate: true, draft: true, labels: ['cadre-generated'], reviewers: [], linkIssue: true },
  options: {
    maxParallelIssues: 3,
    maxParallelAgents: 3,
    maxRetriesPerTask: 3,
    dryRun: false,
    resume: false,
    invocationDelayMs: 0,
    buildVerification: true,
    testVerification: true,
    skipValidation: false,
  },
  commands: {},
  copilot: { cliCommand: 'copilot', model: 'claude-sonnet-4.6', agentDir: '.github/agents', timeout: 300_000 },
  environment: { inheritShellPath: true, extraPath: [] },
};

describe('applyOverrides – skipValidation', () => {
  it('should default skipValidation to false in the base config', () => {
    expect(baseConfig.options.skipValidation).toBe(false);
  });

  it('should set skipValidation to true when override is true', () => {
    const result = applyOverrides(baseConfig, { skipValidation: true });
    expect(result.options.skipValidation).toBe(true);
  });

  it('should set skipValidation to false when override is false', () => {
    const config = applyOverrides(baseConfig, { skipValidation: true });
    const result = applyOverrides(config, { skipValidation: false });
    expect(result.options.skipValidation).toBe(false);
  });

  it('should not change skipValidation when override is undefined', () => {
    const result = applyOverrides(baseConfig, {});
    expect(result.options.skipValidation).toBe(false);
  });

  it('should preserve other options when applying skipValidation override', () => {
    const result = applyOverrides(baseConfig, { skipValidation: true });
    expect(result.options.dryRun).toBe(false);
    expect(result.options.resume).toBe(false);
    expect(result.options.maxParallelIssues).toBe(3);
  });

  it('should return a frozen object', () => {
    const result = applyOverrides(baseConfig, { skipValidation: true });
    expect(Object.isFrozen(result)).toBe(true);
  });
});
