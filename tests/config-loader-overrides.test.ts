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
    respondToReviews: false,
  },
  commands: {},
  copilot: { cliCommand: 'copilot', model: 'claude-sonnet-4.6', agentDir: '.github/agents', timeout: 300_000 },
  environment: { inheritShellPath: true, extraPath: [] },
  isolation: { enabled: false, provider: 'host', policyProfile: 'default', allowFallbackToHost: false },
};

describe('applyOverrides – noPr', () => {
  it('should set pullRequest.autoCreate to false when noPr is true', () => {
    const result = applyOverrides(baseConfig, { noPr: true });
    expect(result.pullRequest.autoCreate).toBe(false);
  });

  it('should set pullRequest.autoCreate to true when noPr is false', () => {
    const configWithAutoCreateFalse = applyOverrides(baseConfig, { noPr: true });
    const result = applyOverrides(configWithAutoCreateFalse, { noPr: false });
    expect(result.pullRequest.autoCreate).toBe(true);
  });

  it('should not change pullRequest.autoCreate when noPr is undefined', () => {
    const result = applyOverrides(baseConfig, {});
    expect(result.pullRequest.autoCreate).toBe(true);
  });

  it('should preserve other pullRequest fields when applying noPr override', () => {
    const result = applyOverrides(baseConfig, { noPr: true });
    expect(result.pullRequest.draft).toBe(true);
    expect(result.pullRequest.labels).toEqual(['cadre-generated']);
    expect(result.pullRequest.linkIssue).toBe(true);
  });

  it('should preserve other options when applying noPr override', () => {
    const result = applyOverrides(baseConfig, { noPr: true });
    expect(result.options.dryRun).toBe(false);
    expect(result.options.resume).toBe(false);
    expect(result.options.maxParallelIssues).toBe(3);
  });

  it('should return a frozen object', () => {
    const result = applyOverrides(baseConfig, { noPr: true });
    expect(Object.isFrozen(result)).toBe(true);
  });
});

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

describe('applyOverrides – respondToReviews', () => {
  it('should set respondToReviews to true when override is true', () => {
    const result = applyOverrides(baseConfig, { respondToReviews: true });
    expect(result.options.respondToReviews).toBe(true);
  });

  it('should set respondToReviews to false when override is false', () => {
    const config = applyOverrides(baseConfig, { respondToReviews: true });
    const result = applyOverrides(config, { respondToReviews: false });
    expect(result.options.respondToReviews).toBe(false);
  });

  it('should not change respondToReviews when override is undefined', () => {
    const result = applyOverrides(baseConfig, {});
    expect(result.options.respondToReviews).toBe(false);
  });

  it('should preserve other options when applying respondToReviews override', () => {
    const result = applyOverrides(baseConfig, { respondToReviews: true });
    expect(result.options.dryRun).toBe(false);
    expect(result.options.resume).toBe(false);
    expect(result.options.maxParallelIssues).toBe(3);
  });

  it('should return a frozen object', () => {
    const result = applyOverrides(baseConfig, { respondToReviews: true });
    expect(Object.isFrozen(result)).toBe(true);
  });
});

describe('applyOverrides – provider', () => {
  it('should set isolation.provider to docker when override is "docker"', () => {
    const result = applyOverrides(baseConfig, { provider: 'docker' });
    expect(result.isolation.provider).toBe('docker');
  });

  it('should set isolation.provider to host when override is "host"', () => {
    const config = applyOverrides(baseConfig, { provider: 'docker' });
    const result = applyOverrides(config, { provider: 'host' });
    expect(result.isolation.provider).toBe('host');
  });

  it('should not change isolation.provider when override is undefined', () => {
    const result = applyOverrides(baseConfig, {});
    expect(result.isolation.provider).toBe('host');
  });

  it('should preserve other isolation fields when applying provider override', () => {
    const result = applyOverrides(baseConfig, { provider: 'docker' });
    expect(result.isolation.enabled).toBe(false);
    expect(result.isolation.policyProfile).toBe('default');
    expect(result.isolation.allowFallbackToHost).toBe(false);
  });

  it('should preserve other top-level config fields when applying provider override', () => {
    const result = applyOverrides(baseConfig, { provider: 'docker' });
    expect(result.options.dryRun).toBe(false);
    expect(result.pullRequest.autoCreate).toBe(true);
  });

  it('should return a frozen object', () => {
    const result = applyOverrides(baseConfig, { provider: 'docker' });
    expect(Object.isFrozen(result)).toBe(true);
  });
});
