import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PullRequestCreator } from '../src/git/pr.js';
import { GitHubAPI } from '../src/github/api.js';
import { GitHubMCPClient } from '../src/github/mcp-client.js';
import { Logger } from '../src/logging/logger.js';
import type { CadreConfig } from '../src/config/schema.js';

describe('PullRequestCreator', () => {
  let creator: PullRequestCreator;
  let mockLogger: Logger;
  let mockConfig: CadreConfig;
  let mockMCP: GitHubMCPClient;
  let api: GitHubAPI;

  beforeEach(() => {
    mockLogger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    } as unknown as Logger;

    mockConfig = {
      projectName: 'test-project',
      repository: 'owner/repo',
      baseBranch: 'main',
      pullRequest: {
        autoCreate: true,
        draft: true,
        labels: ['cadre-generated'],
        reviewers: [],
        linkIssue: true,
      },
    } as CadreConfig;

    mockMCP = {
      callTool: vi.fn(),
      checkAuth: vi.fn(),
      connect: vi.fn(),
      disconnect: vi.fn(),
      isConnected: vi.fn().mockReturnValue(true),
    } as unknown as GitHubMCPClient;

    api = new GitHubAPI('owner/repo', mockLogger, mockMCP);
    creator = new PullRequestCreator(mockConfig, mockLogger, api);
  });

  describe('exists', () => {
    it('should detect existing PR', async () => {
      vi.mocked(mockMCP.callTool).mockResolvedValue([
        {
          number: 87,
          html_url: 'https://github.com/owner/repo/pull/87',
          title: 'Fix login',
          head: { ref: 'cadre/issue-42' },
          base: { ref: 'main' },
        },
      ]);

      const result = await creator.exists('cadre/issue-42');
      expect(result).toBeDefined();
      expect(result!.number).toBe(87);
    });

    it('should return null when no PR exists', async () => {
      vi.mocked(mockMCP.callTool).mockResolvedValue([]);

      const result = await creator.exists('cadre/issue-42');
      expect(result).toBeNull();
    });
  });

  describe('create', () => {
    it('should create a PR with the correct title and return PullRequestInfo', async () => {
      vi.mocked(mockMCP.callTool).mockResolvedValue({
        number: 99,
        html_url: 'https://github.com/owner/repo/pull/99',
        title: 'Fix login (#42)',
      });

      const result = await creator.create(42, 'Fix login', 'cadre/issue-42', 'body text', '/tmp/wt');

      expect(result.number).toBe(99);
      expect(result.url).toBe('https://github.com/owner/repo/pull/99');
      expect(result.title).toBe('Fix login (#42)');
      expect(result.headBranch).toBe('cadre/issue-42');
      expect(result.baseBranch).toBe('main');
    });

    it('should append "Closes #N" to body when linkIssue is true', async () => {
      vi.mocked(mockMCP.callTool).mockResolvedValue({
        number: 99,
        html_url: 'https://github.com/owner/repo/pull/99',
      });

      await creator.create(42, 'Fix login', 'cadre/issue-42', 'body text', '/tmp/wt');

      const callArgs = vi.mocked(mockMCP.callTool).mock.calls[0];
      const inputBody = (callArgs[1] as Record<string, unknown>)?.body as string;
      expect(inputBody).toContain('Closes #42');
    });

    it('should not append "Closes #N" when linkIssue is false', async () => {
      mockConfig.pullRequest.linkIssue = false;
      creator = new PullRequestCreator(mockConfig, mockLogger, api);

      vi.mocked(mockMCP.callTool).mockResolvedValue({
        number: 99,
        html_url: 'https://github.com/owner/repo/pull/99',
      });

      await creator.create(42, 'Fix login', 'cadre/issue-42', 'body text', '/tmp/wt');

      const callArgs = vi.mocked(mockMCP.callTool).mock.calls[0];
      const inputBody = (callArgs[1] as Record<string, unknown>)?.body as string;
      expect(inputBody).not.toContain('Closes #42');
    });

    it('should log info with PR number and URL after creation', async () => {
      vi.mocked(mockMCP.callTool).mockResolvedValue({
        number: 99,
        html_url: 'https://github.com/owner/repo/pull/99',
      });

      await creator.create(42, 'Fix login', 'cadre/issue-42', 'body', '/tmp/wt');

      expect(mockLogger.info).toHaveBeenCalledWith(
        expect.stringContaining('Created PR #99'),
        expect.any(Object),
      );
    });
  });

  describe('update', () => {
    it('should call api.updatePullRequest with prNumber and updates', async () => {
      vi.mocked(mockMCP.callTool).mockResolvedValue({});

      await creator.update(99, { title: 'New Title', body: 'New body' });

      expect(mockMCP.callTool).toHaveBeenCalled();
    });

    it('should log warn and not throw when update fails', async () => {
      vi.mocked(mockMCP.callTool).mockRejectedValueOnce(new Error('API error'));

      await expect(creator.update(99, { title: 'New Title' })).resolves.toBeUndefined();
      expect(mockLogger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Failed to update PR #99'),
      );
    });
  });

  it('should have create method', () => {
    expect(typeof creator.create).toBe('function');
  });

  it('should have update method', () => {
    expect(typeof creator.update).toBe('function');
  });
});
