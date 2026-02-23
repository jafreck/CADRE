import { describe, it, expect, vi, beforeEach } from 'vitest';
import { IssueFetcher } from '../src/github/issues.js';
import { GitHubMCPClient } from '../src/github/mcp-client.js';
import { Logger } from '../src/logging/logger.js';

describe('IssueFetcher', () => {
  let fetcher: IssueFetcher;
  let mockLogger: Logger;
  let mockMCP: GitHubMCPClient;

  beforeEach(() => {
    mockLogger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    } as unknown as Logger;

    mockMCP = {
      callTool: vi.fn(),
      checkAuth: vi.fn(),
      connect: vi.fn(),
      disconnect: vi.fn(),
      isConnected: vi.fn().mockReturnValue(true),
    } as unknown as GitHubMCPClient;

    fetcher = new IssueFetcher('owner/repo', mockLogger, mockMCP);
  });

  describe('postComment', () => {
    it('should post a comment to the specified issue', async () => {
      vi.mocked(mockMCP.callTool).mockResolvedValueOnce(undefined);

      await fetcher.postComment(42, 'Hello from CADRE');

      expect(mockMCP.callTool).toHaveBeenCalledWith('add_issue_comment', {
        owner: 'owner',
        repo: 'repo',
        issue_number: 42,
        body: 'Hello from CADRE',
      });
    });

    it('should resolve without error on success', async () => {
      vi.mocked(mockMCP.callTool).mockResolvedValueOnce(undefined);

      await expect(fetcher.postComment(1, 'test comment')).resolves.toBeUndefined();
    });

    it('should propagate errors from the underlying API call', async () => {
      const apiError = new Error('GitHub API error');
      vi.mocked(mockMCP.callTool).mockRejectedValueOnce(apiError);

      await expect(fetcher.postComment(42, 'test')).rejects.toThrow('GitHub API error');
    });

    it('should log a debug message before posting', async () => {
      vi.mocked(mockMCP.callTool).mockResolvedValueOnce(undefined);

      await fetcher.postComment(7, 'my comment');

      expect(mockLogger.debug).toHaveBeenCalledWith(
        expect.stringContaining('7'),
        expect.objectContaining({ issueNumber: 7 }),
      );
    });
  });
});
