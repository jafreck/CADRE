import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createPlatformProvider } from '../src/platform/factory.js';
import { GitHubProvider } from '../src/platform/github-provider.js';
import { AzureDevOpsProvider } from '../src/platform/azure-devops-provider.js';
import type { ReviewComment, ReviewThread } from '../src/platform/provider.js';
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

  it('should create GitHubProvider with token-based auth', () => {
    const config = CadreConfigSchema.parse({
      ...baseConfig,
      repository: 'owner/repo',
      github: {
        auth: {
          token: 'ghp_test123',
        },
      },
    });

    const provider = createPlatformProvider(config, mockLogger);
    expect(provider).toBeInstanceOf(GitHubProvider);
    expect(mockLogger.info).toHaveBeenCalledWith(
      expect.stringContaining('token-based'),
    );
  });

  it('should create GitHubProvider with zero-config when GITHUB_TOKEN is set', () => {
    process.env.GITHUB_TOKEN = 'ghp_env_token';

    const config = CadreConfigSchema.parse({
      ...baseConfig,
      repository: 'owner/repo',
    });

    const provider = createPlatformProvider(config, mockLogger);
    expect(provider).toBeInstanceOf(GitHubProvider);
    expect(mockLogger.info).toHaveBeenCalledWith(
      expect.stringContaining('Auto-detected'),
    );

    delete process.env.GITHUB_TOKEN;
  });

  it('should create GitHubProvider with zero-config when GH_TOKEN is set', () => {
    process.env.GH_TOKEN = 'ghp_gh_token';

    const config = CadreConfigSchema.parse({
      ...baseConfig,
      repository: 'owner/repo',
    });

    const provider = createPlatformProvider(config, mockLogger);
    expect(provider).toBeInstanceOf(GitHubProvider);
    expect(mockLogger.info).toHaveBeenCalledWith(
      expect.stringContaining('Auto-detected'),
    );

    delete process.env.GH_TOKEN;
  });

  it('should warn when no GitHub auth is available', () => {
    // Make sure no tokens are set
    const savedGH = process.env.GITHUB_TOKEN;
    const savedGhToken = process.env.GH_TOKEN;
    delete process.env.GITHUB_TOKEN;
    delete process.env.GH_TOKEN;

    const config = CadreConfigSchema.parse({
      ...baseConfig,
      repository: 'owner/repo',
    });

    const provider = createPlatformProvider(config, mockLogger);
    expect(provider).toBeInstanceOf(GitHubProvider);
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining('No GitHub authentication configured'),
    );

    // Restore
    if (savedGH) process.env.GITHUB_TOKEN = savedGH;
    if (savedGhToken) process.env.GH_TOKEN = savedGhToken;
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

describe('PlatformProvider interface shape', () => {
  it('GitHubProvider should expose listPRReviewComments method', () => {
    const provider = new GitHubProvider(
      'owner/repo',
      { command: 'github-mcp-server', args: ['stdio'] },
      mockLogger,
    );
    expect(typeof provider.listPRReviewComments).toBe('function');
  });

  it('AzureDevOpsProvider should expose listPRReviewComments method', () => {
    const provider = new AzureDevOpsProvider(
      {
        organization: 'my-org',
        project: 'my-project',
        auth: { pat: 'token' },
      },
      mockLogger,
    );
    expect(typeof provider.listPRReviewComments).toBe('function');
  });

  it('GitHubProvider should expose findOpenPR method', () => {
    const provider = new GitHubProvider(
      'owner/repo',
      { command: 'github-mcp-server', args: ['stdio'] },
      mockLogger,
    );
    expect(typeof provider.findOpenPR).toBe('function');
  });

  it('AzureDevOpsProvider should expose findOpenPR method', () => {
    const provider = new AzureDevOpsProvider(
      {
        organization: 'my-org',
        project: 'my-project',
        auth: { pat: 'token' },
      },
      mockLogger,
    );
    expect(typeof provider.findOpenPR).toBe('function');
  });

  it('GitHubProvider.listPRReviewComments should throw when not connected', async () => {
    const provider = new GitHubProvider(
      'owner/repo',
      { command: 'github-mcp-server', args: ['stdio'] },
      mockLogger,
    );
    await expect(provider.listPRReviewComments(1)).rejects.toThrow('GitHubProvider not connected');
  });

  it('AzureDevOpsProvider.listPRReviewComments should return empty array', async () => {
    const provider = new AzureDevOpsProvider(
      {
        organization: 'my-org',
        project: 'my-project',
        auth: { pat: 'token' },
      },
      mockLogger,
    );
    await expect(provider.listPRReviewComments(1)).resolves.toEqual([]);
  });
});

describe('ReviewComment and ReviewThread interface shapes', () => {
  it('ReviewComment should accept a valid object with all required fields', () => {
    const comment: ReviewComment = {
      id: 'c1',
      author: 'alice',
      body: 'Looks good',
      createdAt: '2024-01-01T00:00:00Z',
      path: 'src/index.ts',
    };
    expect(comment.id).toBe('c1');
    expect(comment.author).toBe('alice');
    expect(comment.body).toBe('Looks good');
    expect(comment.createdAt).toBe('2024-01-01T00:00:00Z');
    expect(comment.path).toBe('src/index.ts');
    expect(comment.line).toBeUndefined();
  });

  it('ReviewComment should accept an optional line field', () => {
    const comment: ReviewComment = {
      id: 'c2',
      author: 'bob',
      body: 'Fix this',
      createdAt: '2024-01-02T00:00:00Z',
      path: 'src/util.ts',
      line: 42,
    };
    expect(comment.line).toBe(42);
  });

  it('ReviewThread should accept a valid object with all required fields', () => {
    const comment: ReviewComment = {
      id: 'c1',
      author: 'alice',
      body: 'LGTM',
      createdAt: '2024-01-01T00:00:00Z',
      path: 'src/index.ts',
    };
    const thread: ReviewThread = {
      id: 't1',
      prNumber: 7,
      isResolved: false,
      isOutdated: false,
      comments: [comment],
    };
    expect(thread.id).toBe('t1');
    expect(thread.prNumber).toBe(7);
    expect(thread.isResolved).toBe(false);
    expect(thread.isOutdated).toBe(false);
    expect(thread.comments).toHaveLength(1);
    expect(thread.comments[0]).toEqual(comment);
  });

  it('ReviewThread should support resolved and outdated state', () => {
    const thread: ReviewThread = {
      id: 't2',
      prNumber: 8,
      isResolved: true,
      isOutdated: true,
      comments: [],
    };
    expect(thread.isResolved).toBe(true);
    expect(thread.isOutdated).toBe(true);
    expect(thread.comments).toHaveLength(0);
  });

  it('ReviewThread should support multiple comments', () => {
    const comments: ReviewComment[] = [
      { id: 'c1', author: 'alice', body: 'first', createdAt: '2024-01-01T00:00:00Z', path: 'a.ts' },
      { id: 'c2', author: 'bob', body: 'second', createdAt: '2024-01-02T00:00:00Z', path: 'a.ts', line: 10 },
    ];
    const thread: ReviewThread = {
      id: 't3',
      prNumber: 9,
      isResolved: false,
      isOutdated: false,
      comments,
    };
    expect(thread.comments).toHaveLength(2);
    expect(thread.comments[1].line).toBe(10);
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

  it('should throw when calling findOpenPR before connect', async () => {
    const provider = new GitHubProvider(
      'owner/repo',
      { command: 'github-mcp-server', args: ['stdio'] },
      mockLogger,
    );
    await expect(provider.findOpenPR(1, 'feature-branch')).rejects.toThrow('not connected');
  });

  it('should expose ensureLabel method', () => {
    const provider = new GitHubProvider(
      'owner/repo',
      { command: 'github-mcp-server', args: ['stdio'] },
      mockLogger,
    );
    expect(typeof provider.ensureLabel).toBe('function');
  });

  it('should throw when calling ensureLabel before connect', async () => {
    const provider = new GitHubProvider(
      'owner/repo',
      { command: 'github-mcp-server', args: ['stdio'] },
      mockLogger,
    );
    await expect(provider.ensureLabel('bug')).rejects.toThrow('not connected');
  });

  it('should expose applyLabels method', () => {
    const provider = new GitHubProvider(
      'owner/repo',
      { command: 'github-mcp-server', args: ['stdio'] },
      mockLogger,
    );
    expect(typeof provider.applyLabels).toBe('function');
  });

  it('should throw when calling applyLabels before connect', async () => {
    const provider = new GitHubProvider(
      'owner/repo',
      { command: 'github-mcp-server', args: ['stdio'] },
      mockLogger,
    );
    await expect(provider.applyLabels(1, ['bug'])).rejects.toThrow('not connected');
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

  it('should throw when calling findOpenPR before connect', async () => {
    const provider = new AzureDevOpsProvider(
      {
        organization: 'my-org',
        project: 'my-project',
        auth: { pat: 'token' },
      },
      mockLogger,
    );
    await expect(provider.findOpenPR(1, 'feature-branch')).rejects.toThrow('not connected');
  });
});
