import { describe, it, expect } from 'vitest';
import { CadreConfigSchema } from '../src/config/schema.js';
import type { NotificationsConfig } from '../src/config/schema.js';

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

  describe('options.postCostComment', () => {
    it('should default postCostComment to false when omitted', () => {
      const result = CadreConfigSchema.parse(validConfig);
      expect(result.options.postCostComment).toBe(false);
    });

    it('should accept postCostComment set to true', () => {
      const result = CadreConfigSchema.safeParse({
        ...validConfig,
        options: { postCostComment: true },
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.options.postCostComment).toBe(true);
      }
    });

    it('should accept postCostComment explicitly set to false', () => {
      const result = CadreConfigSchema.safeParse({
        ...validConfig,
        options: { postCostComment: false },
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.options.postCostComment).toBe(false);
      }
    });

    it('should reject non-boolean postCostComment', () => {
      const result = CadreConfigSchema.safeParse({
        ...validConfig,
        options: { postCostComment: 'yes' },
      });
      expect(result.success).toBe(false);
    });

    it('postCostComment should be boolean in CadreConfig type', () => {
      const result = CadreConfigSchema.parse(validConfig);
      const flag: boolean = result.options.postCostComment;
      expect(typeof flag).toBe('boolean');
    });
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

  describe('notifications', () => {
    it('should default notifications to disabled when omitted', () => {
      const result = CadreConfigSchema.parse(validConfig);
      expect(result.notifications.enabled).toBe(false);
      expect(result.notifications.providers).toEqual([]);
    });

    it('should accept a valid notifications section with webhook provider', () => {
      const result = CadreConfigSchema.safeParse({
        ...validConfig,
        notifications: {
          enabled: true,
          providers: [
            { type: 'webhook', url: 'https://example.com/hook' },
          ],
        },
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.notifications.enabled).toBe(true);
        expect(result.data.notifications.providers).toHaveLength(1);
        expect(result.data.notifications.providers[0].type).toBe('webhook');
        expect(result.data.notifications.providers[0].url).toBe('https://example.com/hook');
      }
    });

    it('should accept a slack provider with channel', () => {
      const result = CadreConfigSchema.safeParse({
        ...validConfig,
        notifications: {
          enabled: true,
          providers: [
            { type: 'slack', webhookUrl: 'https://hooks.slack.com/xxx', channel: '#alerts' },
          ],
        },
      });
      expect(result.success).toBe(true);
      if (result.success) {
        const p = result.data.notifications.providers[0];
        expect(p.type).toBe('slack');
        expect(p.webhookUrl).toBe('https://hooks.slack.com/xxx');
        expect(p.channel).toBe('#alerts');
      }
    });

    it('should accept a log provider with logFile', () => {
      const result = CadreConfigSchema.safeParse({
        ...validConfig,
        notifications: {
          enabled: true,
          providers: [
            { type: 'log', logFile: '/var/log/cadre.log' },
          ],
        },
      });
      expect(result.success).toBe(true);
      if (result.success) {
        const p = result.data.notifications.providers[0];
        expect(p.type).toBe('log');
        expect(p.logFile).toBe('/var/log/cadre.log');
      }
    });

    it('should accept multiple providers', () => {
      const result = CadreConfigSchema.safeParse({
        ...validConfig,
        notifications: {
          enabled: true,
          providers: [
            { type: 'webhook', url: 'https://example.com/hook' },
            { type: 'log', logFile: '/tmp/cadre.log' },
          ],
        },
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.notifications.providers).toHaveLength(2);
      }
    });

    it('should accept ${ENV_VAR} syntax in url and webhookUrl', () => {
      const result = CadreConfigSchema.safeParse({
        ...validConfig,
        notifications: {
          enabled: true,
          providers: [
            { type: 'webhook', url: '${WEBHOOK_URL}' },
            { type: 'slack', webhookUrl: '${SLACK_WEBHOOK}' },
          ],
        },
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.notifications.providers[0].url).toBe('${WEBHOOK_URL}');
        expect(result.data.notifications.providers[1].webhookUrl).toBe('${SLACK_WEBHOOK}');
      }
    });

    it('should accept a provider with an events filter array', () => {
      const result = CadreConfigSchema.safeParse({
        ...validConfig,
        notifications: {
          enabled: true,
          providers: [
            { type: 'log', events: ['issue-completed', 'issue-failed'] },
          ],
        },
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.notifications.providers[0].events).toEqual(['issue-completed', 'issue-failed']);
      }
    });

    it('should default enabled to false when not specified inside notifications', () => {
      const result = CadreConfigSchema.safeParse({
        ...validConfig,
        notifications: { providers: [{ type: 'log' }] },
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.notifications.enabled).toBe(false);
      }
    });

    it('should default providers to [] when not specified inside notifications', () => {
      const result = CadreConfigSchema.safeParse({
        ...validConfig,
        notifications: { enabled: true },
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.notifications.providers).toEqual([]);
      }
    });

    it('should reject an invalid provider type', () => {
      const result = CadreConfigSchema.safeParse({
        ...validConfig,
        notifications: {
          enabled: true,
          providers: [{ type: 'email', url: 'https://example.com' }],
        },
      });
      expect(result.success).toBe(false);
    });

    it('NotificationsConfig type alias should satisfy the inferred shape', () => {
      // Compile-time check: assign a parse result to NotificationsConfig
      const result = CadreConfigSchema.parse(validConfig);
      const nc: NotificationsConfig = result.notifications;
      expect(nc.enabled).toBe(false);
      expect(nc.providers).toEqual([]);
    });
  });
});
