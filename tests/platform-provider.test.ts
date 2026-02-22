import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createPlatformProvider } from '../src/platform/factory.js';
import { GitHubProvider } from '../src/platform/github-provider.js';
import { AzureDevOpsProvider } from '../src/platform/azure-devops-provider.js';
import type { CadreConfig } from '../src/config/schema.js';
import { CadreConfigSchema } from '../src/config/schema.js';

const mockLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
  child: vi.fn().mockReturnThis(),
} as any;

describe('Platform Provider Factory', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  const baseConfig = {
    projectName: 'test-project',
    repoPath: '/tmp/repo',
    baseBranch: 'main',
    issues: { ids: [1] },
  };

  it('should create GitHubProvider when platform is "github"', () => {
    const config = CadreConfigSchema.parse({
      ...baseConfig,
      repository: 'owner/repo',
      platform: 'github',
      github: {
        auth: {
          appId: '123',
          installationId: '456',
          privateKeyFile: '/tmp/key.pem',
        },
      },
    });

    const provider = createPlatformProvider(config, mockLogger);
    expect(provider).toBeInstanceOf(GitHubProvider);
    expect(provider.name).toBe('GitHub');
  });

  it('should create GitHubProvider by default when platform is omitted', () => {
    const config = CadreConfigSchema.parse({
      ...baseConfig,
      repository: 'owner/repo',
      github: {
        auth: {
          appId: '123',
          installationId: '456',
          privateKeyFile: '/tmp/key.pem',
        },
      },
    });

    const provider = createPlatformProvider(config, mockLogger);
    expect(provider).toBeInstanceOf(GitHubProvider);
  });

  it('should create AzureDevOpsProvider when platform is "azure-devops"', () => {
    const config = CadreConfigSchema.parse({
      ...baseConfig,
      repository: 'my-repo',
      platform: 'azure-devops',
      azureDevOps: {
        organization: 'my-org',
        project: 'my-project',
        auth: {
          pat: 'my-token',
        },
      },
    });

    const provider = createPlatformProvider(config, mockLogger);
    expect(provider).toBeInstanceOf(AzureDevOpsProvider);
    expect(provider.name).toBe('Azure DevOps');
  });

  it('should throw when github platform selected without github config', () => {
    const config = CadreConfigSchema.parse({
      ...baseConfig,
      repository: 'owner/repo',
      platform: 'github',
    });

    expect(() => createPlatformProvider(config, mockLogger)).toThrow(
      'GitHub platform selected but no "github" configuration provided',
    );
  });

  it('should throw when azure-devops platform selected without azureDevOps config', () => {
    const config = CadreConfigSchema.parse({
      ...baseConfig,
      repository: 'my-repo',
      platform: 'azure-devops',
    });

    expect(() => createPlatformProvider(config, mockLogger)).toThrow(
      'Azure DevOps platform selected but no "azureDevOps" configuration provided',
    );
  });

  it('should resolve env var references in GitHub auth', () => {
    process.env.TEST_APP_ID = '999';
    process.env.TEST_INSTALL_ID = '888';
    process.env.TEST_KEY_FILE = '/test/key.pem';

    const config = CadreConfigSchema.parse({
      ...baseConfig,
      repository: 'owner/repo',
      github: {
        auth: {
          appId: '${TEST_APP_ID}',
          installationId: '${TEST_INSTALL_ID}',
          privateKeyFile: '${TEST_KEY_FILE}',
        },
      },
    });

    const provider = createPlatformProvider(config, mockLogger);
    expect(provider).toBeInstanceOf(GitHubProvider);

    delete process.env.TEST_APP_ID;
    delete process.env.TEST_INSTALL_ID;
    delete process.env.TEST_KEY_FILE;
  });

  it('should resolve env var references in Azure DevOps auth', () => {
    process.env.TEST_ADO_PAT = 'secret-token';

    const config = CadreConfigSchema.parse({
      ...baseConfig,
      repository: 'my-repo',
      platform: 'azure-devops',
      azureDevOps: {
        organization: 'my-org',
        project: 'my-project',
        auth: {
          pat: '${TEST_ADO_PAT}',
        },
      },
    });

    const provider = createPlatformProvider(config, mockLogger);
    expect(provider).toBeInstanceOf(AzureDevOpsProvider);

    delete process.env.TEST_ADO_PAT;
  });
});

describe('GitHubProvider', () => {
  it('should have correct name', () => {
    const provider = new GitHubProvider(
      'owner/repo',
      { command: 'github-mcp-server', args: ['stdio'] },
      mockLogger,
    );
    expect(provider.name).toBe('GitHub');
  });

  it('should produce correct issue link suffix', () => {
    const provider = new GitHubProvider(
      'owner/repo',
      { command: 'github-mcp-server', args: ['stdio'] },
      mockLogger,
    );
    expect(provider.issueLinkSuffix(42)).toBe('Closes #42');
  });

  it('should throw when calling API methods before connect', async () => {
    const provider = new GitHubProvider(
      'owner/repo',
      { command: 'github-mcp-server', args: ['stdio'] },
      mockLogger,
    );
    await expect(provider.getIssue(1)).rejects.toThrow('not connected');
  });
});

describe('AzureDevOpsProvider', () => {
  it('should have correct name', () => {
    const provider = new AzureDevOpsProvider(
      {
        organization: 'my-org',
        project: 'my-project',
        auth: { pat: 'token' },
      },
      mockLogger,
    );
    expect(provider.name).toBe('Azure DevOps');
  });

  it('should produce correct issue link suffix', () => {
    const provider = new AzureDevOpsProvider(
      {
        organization: 'my-org',
        project: 'my-project',
        auth: { pat: 'token' },
      },
      mockLogger,
    );
    expect(provider.issueLinkSuffix(42)).toBe('AB#42');
  });

  it('should throw when calling API methods before connect', async () => {
    const provider = new AzureDevOpsProvider(
      {
        organization: 'my-org',
        project: 'my-project',
        auth: { pat: 'token' },
      },
      mockLogger,
    );
    await expect(provider.getIssue(1)).rejects.toThrow('not connected');
  });
});
