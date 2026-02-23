import { describe, it, expect } from 'vitest';
import { CadreConfigSchema } from '../src/config/schema.js';

describe('CadreConfigSchema', () => {
  const validConfig = {
    projectName: 'test-project',
    repository: 'owner/repo',
    repoPath: '/tmp/repo',
    baseBranch: 'main',
    issues: { ids: [42, 57] },
    github: {
      auth: {
        appId: '12345',
        installationId: '67890',
        privateKeyFile: '/path/to/key.pem',
      },
    },
  };

  it('should validate a minimal valid config', () => {
    const result = CadreConfigSchema.safeParse(validConfig);
    expect(result.success).toBe(true);
  });

  it('should apply defaults for optional fields', () => {
    const result = CadreConfigSchema.parse(validConfig);
    expect(result.baseBranch).toBe('main');
    expect(result.branchTemplate).toBe('cadre/issue-{issue}');
    expect(result.options.maxParallelIssues).toBe(3);
    expect(result.options.maxParallelAgents).toBe(3);
    expect(result.options.dryRun).toBe(false);
    expect(result.options.resume).toBe(false);
    expect(result.pullRequest.draft).toBe(true);
    expect(result.pullRequest.labels).toEqual(['cadre-generated']);
    expect(result.copilot.cliCommand).toBe('copilot');
    expect(result.copilot.agentDir).toBe('.github/agents');
    expect(result.copilot.timeout).toBe(300_000);
    expect(result.github?.mcpServer.command).toBe('github-mcp-server');
    expect(result.github?.mcpServer.args).toEqual(['stdio']);
    // Auth is a union — the validConfig uses App auth
    const auth = result.github?.auth as { appId: string; installationId: string; privateKeyFile: string };
    expect(auth.appId).toBe('12345');
    expect(auth.installationId).toBe('67890');
    expect(auth.privateKeyFile).toBe('/path/to/key.pem');
  });

  it('should reject invalid projectName', () => {
    const result = CadreConfigSchema.safeParse({
      ...validConfig,
      projectName: 'Invalid Name!',
    });
    expect(result.success).toBe(false);
  });

  it('should reject empty repository', () => {
    const result = CadreConfigSchema.safeParse({
      ...validConfig,
      repository: '',
    });
    expect(result.success).toBe(false);
  });

  it('should accept query-based issue selection', () => {
    const result = CadreConfigSchema.safeParse({
      ...validConfig,
      issues: {
        query: {
          labels: ['bug'],
          state: 'open',
          limit: 5,
        },
      },
    });
    expect(result.success).toBe(true);
  });

  it('should reject negative issue IDs', () => {
    const result = CadreConfigSchema.safeParse({
      ...validConfig,
      issues: { ids: [-1] },
    });
    expect(result.success).toBe(false);
  });

  it('should reject maxParallelIssues > 20', () => {
    const result = CadreConfigSchema.safeParse({
      ...validConfig,
      options: { maxParallelIssues: 25 },
    });
    expect(result.success).toBe(false);
  });

  it('should reject maxParallelAgents > 10', () => {
    const result = CadreConfigSchema.safeParse({
      ...validConfig,
      options: { maxParallelAgents: 15 },
    });
    expect(result.success).toBe(false);
  });

  it('should accept full config with all fields', () => {
    const result = CadreConfigSchema.safeParse({
      ...validConfig,
      worktreeRoot: '/tmp/worktrees',
      branchTemplate: 'feature/{issue}-{title}',
      commits: {
        conventional: true,
        sign: false,
        commitPerPhase: true,
        squashBeforePR: true,
      },
      pullRequest: {
        autoCreate: true,
        draft: false,
        labels: ['auto', 'cadre'],
        reviewers: ['reviewer1'],
        linkIssue: true,
      },
      options: {
        maxParallelIssues: 5,
        maxParallelAgents: 3,
        tokenBudget: 500000,
        perIssueTokenBudget: 100000,
      },
      commands: {
        install: 'npm ci',
        build: 'npm run build',
        test: 'npm test',
        lint: 'npm run lint',
      },
      copilot: {
        cliCommand: 'gh copilot',
        model: 'claude-sonnet-4-20250514',
        agentDir: '.github/agents',
        timeout: 600_000,
      },
      github: {
        mcpServer: {
          command: 'github-mcp-server',
          args: ['stdio'],
        },
        auth: {
          appId: '12345',
          installationId: '67890',
          privateKeyFile: '/path/to/private-key.pem',
        },
      },
    });
    expect(result.success).toBe(true);
  });

  it('should reject empty projectName', () => {
    const result = CadreConfigSchema.safeParse({
      ...validConfig,
      projectName: '',
    });
    expect(result.success).toBe(false);
  });

  it('should default platform to github', () => {
    const result = CadreConfigSchema.parse(validConfig);
    expect(result.platform).toBe('github');
  });

  it('should accept azure-devops platform config', () => {
    const result = CadreConfigSchema.safeParse({
      projectName: 'test-project',
      repository: 'my-repo',
      repoPath: '/tmp/repo',
      baseBranch: 'main',
      platform: 'azure-devops',
      issues: { ids: [42] },
      azureDevOps: {
        organization: 'my-org',
        project: 'my-project',
        auth: {
          pat: '${AZURE_DEVOPS_PAT}',
        },
      },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.platform).toBe('azure-devops');
      expect(result.data.azureDevOps?.organization).toBe('my-org');
    }
  });

  it('should reject invalid platform value', () => {
    const result = CadreConfigSchema.safeParse({
      ...validConfig,
      platform: 'bitbucket',
    });
    expect(result.success).toBe(false);
  });

  it('should allow github config without github section when using azure-devops', () => {
    const result = CadreConfigSchema.safeParse({
      projectName: 'test-project',
      repository: 'my-repo',
      repoPath: '/tmp/repo',
      platform: 'azure-devops',
      issues: { ids: [1] },
      azureDevOps: {
        organization: 'org',
        project: 'proj',
        auth: { pat: 'token' },
      },
    });
    expect(result.success).toBe(true);
  });

  it('should accept token-based github auth', () => {
    const result = CadreConfigSchema.safeParse({
      projectName: 'test-project',
      repository: 'owner/repo',
      repoPath: '/tmp/repo',
      issues: { ids: [1] },
      github: {
        auth: {
          token: '${GITHUB_TOKEN}',
        },
      },
    });
    expect(result.success).toBe(true);
  });

  it('should accept zero-config github (no github section at all)', () => {
    const result = CadreConfigSchema.safeParse({
      projectName: 'test-project',
      repository: 'owner/repo',
      repoPath: '/tmp/repo',
      issues: { ids: [1] },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.platform).toBe('github');
      expect(result.data.github).toBeUndefined();
    }
  });

  it('should accept github with no auth (auto-detect from env)', () => {
    const result = CadreConfigSchema.safeParse({
      projectName: 'test-project',
      repository: 'owner/repo',
      repoPath: '/tmp/repo',
      issues: { ids: [1] },
      github: {},
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.github?.auth).toBeUndefined();
    }
  });

  describe('issueUpdates', () => {
    it('should apply correct defaults when issueUpdates is omitted', () => {
      const result = CadreConfigSchema.parse(validConfig);
      expect(result.issueUpdates.enabled).toBe(true);
      expect(result.issueUpdates.onStart).toBe(true);
      expect(result.issueUpdates.onPhaseComplete).toBe(false);
      expect(result.issueUpdates.onComplete).toBe(true);
      expect(result.issueUpdates.onFailed).toBe(true);
      expect(result.issueUpdates.onBudgetWarning).toBe(true);
    });

    it('should validate when issueUpdates is omitted entirely', () => {
      const result = CadreConfigSchema.safeParse(validConfig);
      expect(result.success).toBe(true);
    });

    it('should accept explicit issueUpdates values', () => {
      const result = CadreConfigSchema.parse({
        ...validConfig,
        issueUpdates: {
          enabled: false,
          onStart: false,
          onPhaseComplete: true,
          onComplete: false,
          onFailed: false,
          onBudgetWarning: false,
        },
      });
      expect(result.issueUpdates.enabled).toBe(false);
      expect(result.issueUpdates.onStart).toBe(false);
      expect(result.issueUpdates.onPhaseComplete).toBe(true);
      expect(result.issueUpdates.onComplete).toBe(false);
      expect(result.issueUpdates.onFailed).toBe(false);
      expect(result.issueUpdates.onBudgetWarning).toBe(false);
    });

    it('should apply defaults for unspecified issueUpdates sub-fields', () => {
      const result = CadreConfigSchema.parse({
        ...validConfig,
        issueUpdates: { enabled: false },
      });
      expect(result.issueUpdates.enabled).toBe(false);
      expect(result.issueUpdates.onStart).toBe(true);
      expect(result.issueUpdates.onPhaseComplete).toBe(false);
      expect(result.issueUpdates.onComplete).toBe(true);
      expect(result.issueUpdates.onFailed).toBe(true);
      expect(result.issueUpdates.onBudgetWarning).toBe(true);
    });

    it('should reject non-boolean issueUpdates.enabled', () => {
      const result = CadreConfigSchema.safeParse({
        ...validConfig,
        issueUpdates: { enabled: 'yes' },
      });
      expect(result.success).toBe(false);
    });
  });
});
