import { describe, it, expect } from 'vitest';
import { CadreConfigSchema, AgentConfigSchema } from '../src/config/schema.js';
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
    expect(result.pullRequest.autoComplete).toBe(false);
    expect(result.pullRequest.draft).toBe(true);
    expect(result.pullRequest.labels).toEqual(['cadre-generated']);
    expect(result.agent.backend).toBe('copilot');
    expect(result.agent.copilot.cliCommand).toBe('copilot');
    expect(result.agent.copilot.agentDir).toBe('agents');
    expect(result.agent.timeout).toBe(300_000);
    expect(result.github?.mcpServer.command).toBe('github-mcp-server');
    expect(result.github?.mcpServer.args).toEqual(['stdio']);
    // Auth is a union — the validConfig uses App auth
    const auth = result.github?.auth as { appId: string; installationId: string; privateKeyFile: string };
    expect(auth.appId).toBe('12345');
    expect(auth.installationId).toBe('67890');
    expect(auth.privateKeyFile).toBe('/path/to/key.pem');
  });

  it('should accept pullRequest.autoComplete object with merge_method', () => {
    const result = CadreConfigSchema.safeParse({
      ...validConfig,
      pullRequest: {
        autoComplete: {
          enabled: true,
          merge_method: 'squash',
        },
      },
    });
    expect(result.success).toBe(true);
  });

  it('should reject invalid pullRequest.autoComplete.merge_method', () => {
    const result = CadreConfigSchema.safeParse({
      ...validConfig,
      pullRequest: {
        autoComplete: {
          enabled: true,
          merge_method: 'invalid-method',
        },
      },
    });
    expect(result.success).toBe(false);
  });

  it('should default pullRequest.autoComplete.enabled to false in object form', () => {
    const result = CadreConfigSchema.parse({
      ...validConfig,
      pullRequest: {
        autoComplete: {
          merge_method: 'squash',
        },
      },
    });

    expect(result.pullRequest.autoComplete).toEqual({ enabled: false, merge_method: 'squash' });
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

  describe('perTaskBuildCheck', () => {
    it('should default perTaskBuildCheck to true when omitted', () => {
      const result = CadreConfigSchema.parse(validConfig);
      expect(result.options.perTaskBuildCheck).toBe(true);
    });

    it('should accept perTaskBuildCheck set to false', () => {
      const result = CadreConfigSchema.safeParse({
        ...validConfig,
        options: { perTaskBuildCheck: false },
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.options.perTaskBuildCheck).toBe(false);
      }
    });

    it('should accept perTaskBuildCheck set to true explicitly', () => {
      const result = CadreConfigSchema.safeParse({
        ...validConfig,
        options: { perTaskBuildCheck: true },
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.options.perTaskBuildCheck).toBe(true);
      }
    });

    it('should reject a non-boolean perTaskBuildCheck', () => {
      const result = CadreConfigSchema.safeParse({
        ...validConfig,
        options: { perTaskBuildCheck: 'yes' },
      });
      expect(result.success).toBe(false);
    });
  });

  describe('maxBuildFixRounds', () => {
    it('should default maxBuildFixRounds to 2 when omitted', () => {
      const result = CadreConfigSchema.parse(validConfig);
      expect(result.options.maxBuildFixRounds).toBe(2);
    });

    it('should accept maxBuildFixRounds of 1 (min boundary)', () => {
      const result = CadreConfigSchema.safeParse({
        ...validConfig,
        options: { maxBuildFixRounds: 1 },
      });
      expect(result.success).toBe(true);
    });

    it('should accept maxBuildFixRounds of 5 (max boundary)', () => {
      const result = CadreConfigSchema.safeParse({
        ...validConfig,
        options: { maxBuildFixRounds: 5 },
      });
      expect(result.success).toBe(true);
    });

    it('should accept maxBuildFixRounds of 3 (mid-range)', () => {
      const result = CadreConfigSchema.safeParse({
        ...validConfig,
        options: { maxBuildFixRounds: 3 },
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.options.maxBuildFixRounds).toBe(3);
      }
    });

    it('should reject maxBuildFixRounds of 0 (below min)', () => {
      const result = CadreConfigSchema.safeParse({
        ...validConfig,
        options: { maxBuildFixRounds: 0 },
      });
      expect(result.success).toBe(false);
    });

    it('should reject maxBuildFixRounds of 6 (above max)', () => {
      const result = CadreConfigSchema.safeParse({
        ...validConfig,
        options: { maxBuildFixRounds: 6 },
      });
      expect(result.success).toBe(false);
    });

    it('should reject non-integer maxBuildFixRounds', () => {
      const result = CadreConfigSchema.safeParse({
        ...validConfig,
        options: { maxBuildFixRounds: 1.5 },
      });
      expect(result.success).toBe(false);
    });
  });

  describe('maxIntegrationFixRounds', () => {
    it('should default maxIntegrationFixRounds to 1 when omitted', () => {
      const result = CadreConfigSchema.parse(validConfig);
      expect(result.options.maxIntegrationFixRounds).toBe(1);
    });

    it('should accept maxIntegrationFixRounds of 1 (min boundary)', () => {
      const result = CadreConfigSchema.safeParse({
        ...validConfig,
        options: { maxIntegrationFixRounds: 1 },
      });
      expect(result.success).toBe(true);
    });

    it('should accept maxIntegrationFixRounds of 5 (max boundary)', () => {
      const result = CadreConfigSchema.safeParse({
        ...validConfig,
        options: { maxIntegrationFixRounds: 5 },
      });
      expect(result.success).toBe(true);
    });

    it('should accept maxIntegrationFixRounds of 3 (mid-range)', () => {
      const result = CadreConfigSchema.safeParse({
        ...validConfig,
        options: { maxIntegrationFixRounds: 3 },
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.options.maxIntegrationFixRounds).toBe(3);
      }
    });

    it('should reject maxIntegrationFixRounds of 0 (below min)', () => {
      const result = CadreConfigSchema.safeParse({
        ...validConfig,
        options: { maxIntegrationFixRounds: 0 },
      });
      expect(result.success).toBe(false);
    });

    it('should reject maxIntegrationFixRounds of 6 (above max)', () => {
      const result = CadreConfigSchema.safeParse({
        ...validConfig,
        options: { maxIntegrationFixRounds: 6 },
      });
      expect(result.success).toBe(false);
    });

    it('should reject non-integer maxIntegrationFixRounds', () => {
      const result = CadreConfigSchema.safeParse({
        ...validConfig,
        options: { maxIntegrationFixRounds: 1.5 },
      });
      expect(result.success).toBe(false);
    });
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
        autoComplete: true,
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

  describe('ambiguityThreshold', () => {
    it('should default ambiguityThreshold to 5 when omitted', () => {
      const result = CadreConfigSchema.parse(validConfig);
      expect(result.options.ambiguityThreshold).toBe(5);
    });

    it('should accept an explicit ambiguityThreshold value', () => {
      const result = CadreConfigSchema.safeParse({
        ...validConfig,
        options: { ambiguityThreshold: 10 },
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.options.ambiguityThreshold).toBe(10);
      }
    });

    it('should accept ambiguityThreshold of 0 (min boundary)', () => {
      const result = CadreConfigSchema.safeParse({
        ...validConfig,
        options: { ambiguityThreshold: 0 },
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.options.ambiguityThreshold).toBe(0);
      }
    });

    it('should reject non-integer ambiguityThreshold', () => {
      const result = CadreConfigSchema.safeParse({
        ...validConfig,
        options: { ambiguityThreshold: 2.5 },
      });
      expect(result.success).toBe(false);
    });

    it('should reject negative ambiguityThreshold', () => {
      const result = CadreConfigSchema.safeParse({
        ...validConfig,
        options: { ambiguityThreshold: -1 },
      });
      expect(result.success).toBe(false);
    });
  });

  describe('haltOnAmbiguity', () => {
    it('should default haltOnAmbiguity to false when omitted', () => {
      const result = CadreConfigSchema.parse(validConfig);
      expect(result.options.haltOnAmbiguity).toBe(false);
    });

    it('should accept haltOnAmbiguity set to true', () => {
      const result = CadreConfigSchema.safeParse({
        ...validConfig,
        options: { haltOnAmbiguity: true },
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.options.haltOnAmbiguity).toBe(true);
      }
    });

    it('should accept haltOnAmbiguity set to false explicitly', () => {
      const result = CadreConfigSchema.safeParse({
        ...validConfig,
        options: { haltOnAmbiguity: false },
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.options.haltOnAmbiguity).toBe(false);
      }
    });

    it('should reject a non-boolean haltOnAmbiguity', () => {
      const result = CadreConfigSchema.safeParse({
        ...validConfig,
        options: { haltOnAmbiguity: 'yes' },
      });
      expect(result.success).toBe(false);
    });
  });

  describe('respondToReviews', () => {
    it('should default respondToReviews to false when omitted', () => {
      const result = CadreConfigSchema.parse(validConfig);
      expect(result.options.respondToReviews).toBe(false);
    });

    it('should accept respondToReviews set to true', () => {
      const result = CadreConfigSchema.safeParse({
        ...validConfig,
        options: { respondToReviews: true },
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.options.respondToReviews).toBe(true);
      }
    });

    it('should accept respondToReviews set to false explicitly', () => {
      const result = CadreConfigSchema.safeParse({
        ...validConfig,
        options: { respondToReviews: false },
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.options.respondToReviews).toBe(false);
      }
    });

    it('should reject a non-boolean respondToReviews', () => {
      const result = CadreConfigSchema.safeParse({
        ...validConfig,
        options: { respondToReviews: 'yes' },
      });
      expect(result.success).toBe(false);
    });
  });

  describe('reviewResponse', () => {
    it('should default reviewResponse.autoReplyOnResolved to false when omitted', () => {
      const result = CadreConfigSchema.parse(validConfig);
      expect(result.reviewResponse.autoReplyOnResolved).toBe(false);
    });

    it('should accept reviewResponse.autoReplyOnResolved set to true', () => {
      const result = CadreConfigSchema.safeParse({
        ...validConfig,
        reviewResponse: { autoReplyOnResolved: true },
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.reviewResponse.autoReplyOnResolved).toBe(true);
      }
    });

    it('should accept reviewResponse.autoReplyOnResolved set to false explicitly', () => {
      const result = CadreConfigSchema.safeParse({
        ...validConfig,
        reviewResponse: { autoReplyOnResolved: false },
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.reviewResponse.autoReplyOnResolved).toBe(false);
      }
    });

    it('should reject a non-boolean reviewResponse.autoReplyOnResolved', () => {
      const result = CadreConfigSchema.safeParse({
        ...validConfig,
        reviewResponse: { autoReplyOnResolved: 'yes' },
      });
      expect(result.success).toBe(false);
    });

    it('should default reviewResponse to empty object when omitted', () => {
      const result = CadreConfigSchema.parse(validConfig);
      expect(result.reviewResponse).toEqual({ autoReplyOnResolved: false });
    });
  });

  describe('ambiguityThreshold and haltOnAmbiguity together', () => {
    it('should accept both fields set explicitly alongside other options', () => {
      const result = CadreConfigSchema.safeParse({
        ...validConfig,
        options: { ambiguityThreshold: 3, haltOnAmbiguity: true },
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.options.ambiguityThreshold).toBe(3);
        expect(result.data.options.haltOnAmbiguity).toBe(true);
      }
    });
  });

  describe('agent field', () => {
    it('should apply default agent config when agent field is omitted', () => {
      const result = CadreConfigSchema.safeParse(validConfig);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.agent).toBeDefined();
        expect(result.data.agent.backend).toBe('copilot');
      }
    });

    it('should accept a config with a minimal agent section (backend only)', () => {
      const result = CadreConfigSchema.safeParse({
        ...validConfig,
        agent: { backend: 'copilot' },
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.agent?.backend).toBe('copilot');
      }
    });

    it('should accept agent backend set to claude', () => {
      const result = CadreConfigSchema.safeParse({
        ...validConfig,
        agent: { backend: 'claude' },
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.agent?.backend).toBe('claude');
      }
    });

    it('should accept agent with model and timeout', () => {
      const result = CadreConfigSchema.safeParse({
        ...validConfig,
        agent: { backend: 'copilot', model: 'claude-sonnet-4.6', timeout: 60000 },
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.agent?.model).toBe('claude-sonnet-4.6');
        expect(result.data.agent?.timeout).toBe(60000);
      }
    });

    it('should accept agent with copilot sub-options', () => {
      const result = CadreConfigSchema.safeParse({
        ...validConfig,
        agent: {
          backend: 'copilot',
          copilot: { cliCommand: 'gh copilot', agentDir: '.github/agents' },
        },
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.agent?.copilot.cliCommand).toBe('gh copilot');
        expect(result.data.agent?.copilot.agentDir).toBe('.github/agents');
      }
    });

    it('should accept agent with claude sub-options', () => {
      const result = CadreConfigSchema.safeParse({
        ...validConfig,
        agent: { backend: 'claude', claude: { cliCommand: 'claude' } },
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.agent?.claude.cliCommand).toBe('claude');
      }
    });

    it('should accept agent with copilot costOverrides', () => {
      const result = CadreConfigSchema.safeParse({
        ...validConfig,
        agent: {
          backend: 'copilot',
          copilot: {
            costOverrides: {
              'claude-sonnet-4.6': { input: 3.0, output: 15.0 },
            },
          },
        },
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.agent?.copilot.costOverrides?.['claude-sonnet-4.6']).toEqual({
          input: 3.0,
          output: 15.0,
        });
      }
    });

    it('should reject an invalid agent backend value', () => {
      const result = CadreConfigSchema.safeParse({
        ...validConfig,
        agent: { backend: 'openai' },
      });
      expect(result.success).toBe(false);
    });

    it('should reject a non-integer timeout in agent', () => {
      const result = CadreConfigSchema.safeParse({
        ...validConfig,
        agent: { backend: 'copilot', timeout: 1.5 },
      });
      expect(result.success).toBe(false);
    });

    it('should reject negative costOverride values', () => {
      const result = CadreConfigSchema.safeParse({
        ...validConfig,
        agent: {
          backend: 'copilot',
          copilot: {
            costOverrides: { 'some-model': { input: -1, output: 5 } },
          },
        },
      });
      expect(result.success).toBe(false);
    });
  });

  describe('dag', () => {
    it('should default dag to { enabled: false, verifyDepsBuild: false, autoMerge: false, onDependencyMergeConflict: "fail" } when omitted', () => {
      const result = CadreConfigSchema.parse(validConfig);
      expect(result.dag).toEqual({
        enabled: false,
        verifyDepsBuild: false,
        autoMerge: false,
        onDependencyMergeConflict: 'fail',
      });
    });

    it('should accept dag with all fields set to true', () => {
      const result = CadreConfigSchema.safeParse({
        ...validConfig,
        dag: { enabled: true, verifyDepsBuild: true, autoMerge: true, onDependencyMergeConflict: 'resolve' },
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.dag.enabled).toBe(true);
        expect(result.data.dag.verifyDepsBuild).toBe(true);
        expect(result.data.dag.autoMerge).toBe(true);
        expect(result.data.dag.onDependencyMergeConflict).toBe('resolve');
      }
    });

    it('should accept dag with only enabled set', () => {
      const result = CadreConfigSchema.safeParse({
        ...validConfig,
        dag: { enabled: true },
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.dag.enabled).toBe(true);
        expect(result.data.dag.verifyDepsBuild).toBe(false);
        expect(result.data.dag.autoMerge).toBe(false);
        expect(result.data.dag.onDependencyMergeConflict).toBe('fail');
      }
    });

    it('should reject invalid onDependencyMergeConflict value', () => {
      const result = CadreConfigSchema.safeParse({
        ...validConfig,
        dag: { enabled: true, onDependencyMergeConflict: 'ask' },
      });
      expect(result.success).toBe(false);
    });

    it('should reject non-boolean dag.enabled', () => {
      const result = CadreConfigSchema.safeParse({
        ...validConfig,
        dag: { enabled: 'yes' },
      });
      expect(result.success).toBe(false);
    });
  });

  describe('isolation', () => {
    it('should default isolation to { enabled: false, provider: "host", policyProfile: "default", allowFallbackToHost: false } when omitted', () => {
      const result = CadreConfigSchema.parse(validConfig);
      expect(result.isolation).toEqual({
        enabled: false,
        provider: 'host',
        policyProfile: 'default',
        allowFallbackToHost: false,
      });
    });

    it('should accept isolation with enabled: true and provider: "docker"', () => {
      const result = CadreConfigSchema.safeParse({
        ...validConfig,
        isolation: { enabled: true, provider: 'docker' },
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.isolation.enabled).toBe(true);
        expect(result.data.isolation.provider).toBe('docker');
      }
    });

    it('should accept isolation with all fields set', () => {
      const result = CadreConfigSchema.safeParse({
        ...validConfig,
        isolation: {
          enabled: true,
          provider: 'docker',
          policyProfile: 'strict',
          allowFallbackToHost: true,
          dockerOptions: { image: 'node:20-slim', extraArgs: ['--rm'] },
        },
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.isolation.policyProfile).toBe('strict');
        expect(result.data.isolation.allowFallbackToHost).toBe(true);
        expect(result.data.isolation.dockerOptions?.image).toBe('node:20-slim');
        expect(result.data.isolation.dockerOptions?.extraArgs).toEqual(['--rm']);
      }
    });

    it('should reject an unknown isolation provider', () => {
      const result = CadreConfigSchema.safeParse({
        ...validConfig,
        isolation: { provider: 'kubernetes' },
      });
      expect(result.success).toBe(false);
    });

    it('should accept isolation with provider: "host" explicitly', () => {
      const result = CadreConfigSchema.safeParse({
        ...validConfig,
        isolation: { provider: 'host' },
      });
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.isolation.provider).toBe('host');
      }
    });

    it('should apply per-field defaults when isolation object is provided partially', () => {
      const result = CadreConfigSchema.parse({
        ...validConfig,
        isolation: { enabled: true },
      });
      expect(result.isolation.provider).toBe('host');
      expect(result.isolation.policyProfile).toBe('default');
      expect(result.isolation.allowFallbackToHost).toBe(false);
    });
  });
});

describe('AgentConfigSchema', () => {
  it('should default backend to copilot', () => {
    const result = AgentConfigSchema.parse({});
    expect(result.backend).toBe('copilot');
  });

  it('should default copilot.cliCommand to copilot', () => {
    const result = AgentConfigSchema.parse({});
    expect(result.copilot.cliCommand).toBe('copilot');
  });

  it('should default copilot.agentDir to agents', () => {
    const result = AgentConfigSchema.parse({});
    expect(result.copilot.agentDir).toBe('agents');
  });

  it('should default claude.cliCommand to claude', () => {
    const result = AgentConfigSchema.parse({});
    expect(result.claude.cliCommand).toBe('claude');
  });

  it('should default model to claude-sonnet-4.6', () => {
    const result = AgentConfigSchema.parse({});
    expect(result.model).toBe('claude-sonnet-4.6');
  });

  it('should default timeout to 300000', () => {
    const result = AgentConfigSchema.parse({});
    expect(result.timeout).toBe(300_000);
  });

  it('should accept backend claude with custom cliCommand', () => {
    const result = AgentConfigSchema.parse({ backend: 'claude', claude: { cliCommand: '/usr/local/bin/claude' } });
    expect(result.backend).toBe('claude');
    expect(result.claude.cliCommand).toBe('/usr/local/bin/claude');
  });

  it('should leave costOverrides undefined by default', () => {
    const result = AgentConfigSchema.parse({});
    expect(result.copilot.costOverrides).toBeUndefined();
  });

  it('should reject unknown backend values', () => {
    const result = AgentConfigSchema.safeParse({ backend: 'gemini' });
    expect(result.success).toBe(false);
  });
});
