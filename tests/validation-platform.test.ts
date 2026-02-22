import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { CadreConfigSchema } from '../src/config/schema.js';

vi.mock('../src/util/process.js', () => ({
  exec: vi.fn(),
}));

import { exec } from '../src/util/process.js';
import { platformValidator } from '../src/validation/platform-validator.js';

const mockExec = vi.mocked(exec);

const githubConfig = CadreConfigSchema.parse({
  projectName: 'test-project',
  repository: 'owner/repo',
  repoPath: '/tmp/repo',
  platform: 'github',
  issues: { ids: [1] },
  github: { auth: { token: 'ghp_test_token' } },
});

const azureConfig = CadreConfigSchema.parse({
  projectName: 'test-project',
  repository: 'owner/repo',
  repoPath: '/tmp/repo',
  platform: 'azure-devops',
  issues: { ids: [1] },
  azureDevOps: { organization: 'my-org', project: 'my-project', auth: { pat: 'my-pat' } },
});

describe('platformValidator', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    delete process.env['GITHUB_TOKEN'];
  });

  afterEach(() => {
    delete process.env['GITHUB_TOKEN'];
  });

  it('should pass for github platform when MCP server is found and token is configured', async () => {
    mockExec.mockResolvedValue({ exitCode: 0, stdout: '/usr/bin/github-mcp-server', stderr: '', signal: null, timedOut: false });

    const result = await platformValidator.validate(githubConfig);

    expect(result.passed).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('should fail when MCP server command is not found on PATH', async () => {
    mockExec.mockResolvedValue({ exitCode: 1, stdout: '', stderr: 'not found', signal: null, timedOut: false });

    const result = await platformValidator.validate(githubConfig);

    expect(result.passed).toBe(false);
    expect(result.errors).toHaveLength(1);
  });

  it('should fail when no auth is configured and GITHUB_TOKEN is absent', async () => {
    mockExec.mockResolvedValue({ exitCode: 0, stdout: '/usr/bin/github-mcp-server', stderr: '', signal: null, timedOut: false });

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
  });

  it('should pass for azure-devops platform when PAT is configured', async () => {
    const result = await platformValidator.validate(azureConfig);

    expect(result.passed).toBe(true);
    expect(result.errors).toHaveLength(0);
    expect(mockExec).not.toHaveBeenCalled();
  });

  it('should fail for azure-devops platform when azureDevOps config is absent', async () => {
    const noAzureConfig = { ...azureConfig, azureDevOps: undefined };

    const result = await platformValidator.validate(noAzureConfig as typeof azureConfig);

    expect(result.passed).toBe(false);
    expect(result.errors).toHaveLength(1);
  });
});
