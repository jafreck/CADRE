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

  it('should have create method', () => {
    expect(typeof creator.create).toBe('function');
  });

  it('should have update method', () => {
    expect(typeof creator.update).toBe('function');
  });
});
