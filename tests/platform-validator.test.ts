import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { CadreConfigSchema } from '../src/config/schema.js';

vi.mock('../src/util/process.js', () => ({
  exec: vi.fn(),
}));

import { exec } from '../src/util/process.js';
import { platformValidator } from '../src/validation/platform-validator.js';

const mockExec = vi.mocked(exec);

const githubBaseConfig = CadreConfigSchema.parse({
  projectName: 'test-project',
  repository: 'owner/repo',
  repoPath: '/tmp/repo',
  platform: 'github',
  issues: { ids: [1] },
  github: {
    auth: { token: 'ghp_test_token' },
  },
});

const azureBaseConfig = CadreConfigSchema.parse({
  projectName: 'test-project',
  repository: 'owner/repo',
  repoPath: '/tmp/repo',
  platform: 'azure-devops',
  issues: { ids: [1] },
  azureDevOps: {
    organization: 'my-org',
    project: 'my-project',
    auth: { pat: 'my-pat' },
  },
});

const execSuccess = { exitCode: 0, stdout: '/usr/bin/github-mcp-server', stderr: '', signal: null, timedOut: false };
const execFailure = { exitCode: 1, stdout: '', stderr: 'not found', signal: null, timedOut: false };

describe('platformValidator', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    delete process.env['GITHUB_TOKEN'];
  });

  afterEach(() => {
    delete process.env['GITHUB_TOKEN'];
  });

  it('should have name "platform"', () => {
    expect(platformValidator.name).toBe('platform');
  });

  it('should return name "platform" in the result', async () => {
    mockExec.mockResolvedValue(execSuccess);

    const result = await platformValidator.validate(githubBaseConfig);

    expect(result.name).toBe('platform');
  });

  describe('github platform', () => {
    it('should pass when MCP server command is found and token is configured', async () => {
      mockExec.mockResolvedValue(execSuccess);

      const result = await platformValidator.validate(githubBaseConfig);

      expect(result.passed).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(result.warnings).toHaveLength(0);
    });

    it('should fail when MCP server command is not found on PATH', async () => {
      mockExec.mockResolvedValue(execFailure);

      const result = await platformValidator.validate(githubBaseConfig);

      expect(result.passed).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain('github-mcp-server');
      expect(result.errors[0]).toContain('not found on PATH');
    });

    it('should use the configured mcpServer command when checking PATH', async () => {
      const customConfig = CadreConfigSchema.parse({
        projectName: 'test-project',
        repository: 'owner/repo',
        repoPath: '/tmp/repo',
        platform: 'github',
        issues: { ids: [1] },
        github: {
          mcpServer: { command: 'my-mcp-server', args: [] },
          auth: { token: 'ghp_test_token' },
        },
      });

      mockExec.mockResolvedValue(execSuccess);

      await platformValidator.validate(customConfig);

      expect(mockExec).toHaveBeenCalledWith('which', ['my-mcp-server']);
    });

    it('should fail when no auth is configured and GITHUB_TOKEN env var is absent', async () => {
      mockExec.mockResolvedValue(execSuccess);

      const noAuthConfig = CadreConfigSchema.parse({
        projectName: 'test-project',
        repository: 'owner/repo',
        repoPath: '/tmp/repo',
        platform: 'github',
        issues: { ids: [1] },
      });

      const result = await platformValidator.validate(noAuthConfig);

      expect(result.passed).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain('GITHUB_TOKEN');
    });

    it('should pass when no auth is configured but GITHUB_TOKEN env var is set', async () => {
      process.env['GITHUB_TOKEN'] = 'ghp_from_env';
      mockExec.mockResolvedValue(execSuccess);

      const noAuthConfig = CadreConfigSchema.parse({
        projectName: 'test-project',
        repository: 'owner/repo',
        repoPath: '/tmp/repo',
        platform: 'github',
        issues: { ids: [1] },
      });

      const result = await platformValidator.validate(noAuthConfig);

      expect(result.passed).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should pass when GitHub App auth (appId) is configured', async () => {
      mockExec.mockResolvedValue(execSuccess);

      const appAuthConfig = CadreConfigSchema.parse({
        projectName: 'test-project',
        repository: 'owner/repo',
        repoPath: '/tmp/repo',
        platform: 'github',
        issues: { ids: [1] },
        github: {
          auth: { appId: 'app-123', installationId: 'inst-456', privateKeyFile: '/key.pem' },
        },
      });

      const result = await platformValidator.validate(appAuthConfig);

      expect(result.passed).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should fail with two errors when command not found and no token configured', async () => {
      mockExec.mockResolvedValue(execFailure);

      const noAuthConfig = CadreConfigSchema.parse({
        projectName: 'test-project',
        repository: 'owner/repo',
        repoPath: '/tmp/repo',
        platform: 'github',
        issues: { ids: [1] },
      });

      const result = await platformValidator.validate(noAuthConfig);

      expect(result.passed).toBe(false);
      expect(result.errors).toHaveLength(2);
    });

    it('should not fail when GITHUB_TOKEN env var is whitespace only', async () => {
      process.env['GITHUB_TOKEN'] = '   ';
      mockExec.mockResolvedValue(execSuccess);

      const noAuthConfig = CadreConfigSchema.parse({
        projectName: 'test-project',
        repository: 'owner/repo',
        repoPath: '/tmp/repo',
        platform: 'github',
        issues: { ids: [1] },
      });

      const result = await platformValidator.validate(noAuthConfig);

      expect(result.passed).toBe(false);
      expect(result.errors[0]).toContain('GITHUB_TOKEN');
    });
  });

  describe('azure-devops platform', () => {
    it('should pass when PAT is configured', async () => {
      const result = await platformValidator.validate(azureBaseConfig);

      expect(result.passed).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(mockExec).not.toHaveBeenCalled();
    });

    it('should fail when azureDevOps config is absent', async () => {
      const noAzureConfig = {
        ...azureBaseConfig,
        azureDevOps: undefined,
      };

      const result = await platformValidator.validate(noAzureConfig as typeof azureBaseConfig);

      expect(result.passed).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain('PAT');
    });

    it('should not call exec for azure-devops platform', async () => {
      await platformValidator.validate(azureBaseConfig);

      expect(mockExec).not.toHaveBeenCalled();
    });

    it('should return no warnings for a valid azure-devops config', async () => {
      const result = await platformValidator.validate(azureBaseConfig);

      expect(result.warnings).toHaveLength(0);
    });
  });
});
