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
    expect(result.github.mcpServer.command).toBe('github-mcp-server');
    expect(result.github.mcpServer.args).toEqual(['stdio']);
    expect(result.github.auth.appId).toBe('12345');
    expect(result.github.auth.installationId).toBe('67890');
    expect(result.github.auth.privateKeyFile).toBe('/path/to/key.pem');
  });

  it('should reject invalid projectName', () => {
    const result = CadreConfigSchema.safeParse({
      ...validConfig,
      projectName: 'Invalid Name!',
    });
    expect(result.success).toBe(false);
  });

  it('should reject invalid repository format', () => {
    const result = CadreConfigSchema.safeParse({
      ...validConfig,
      repository: 'not-a-repo',
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
});
