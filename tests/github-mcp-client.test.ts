import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Logger } from '../src/logging/logger.js';

vi.mock('@modelcontextprotocol/sdk/client/index.js', () => ({
  Client: vi.fn().mockImplementation(() => ({
    connect: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
    callTool: vi.fn(),
  })),
}));

vi.mock('@modelcontextprotocol/sdk/client/stdio.js', () => ({
  StdioClientTransport: vi.fn().mockImplementation(() => ({})),
}));

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { GitHubMCPClient, type MCPServerConfig } from '../src/github/mcp-client.js';

const serverConfig: MCPServerConfig = {
  command: 'gh',
  args: ['mcp', 'stdio'],
};

function makeLogger(): Logger {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  } as unknown as Logger;
}

function getMockClientInstance() {
  return vi.mocked(Client).mock.results[vi.mocked(Client).mock.results.length - 1].value as {
    connect: ReturnType<typeof vi.fn>;
    close: ReturnType<typeof vi.fn>;
    callTool: ReturnType<typeof vi.fn>;
  };
}

describe('GitHubMCPClient', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── isConnected ──────────────────────────────────────────────────────────

  describe('isConnected()', () => {
    it('returns false before connect', () => {
      const client = new GitHubMCPClient(serverConfig, makeLogger());
      expect(client.isConnected()).toBe(false);
    });

    it('returns true after connect', async () => {
      const client = new GitHubMCPClient(serverConfig, makeLogger());
      await client.connect();
      expect(client.isConnected()).toBe(true);
    });

    it('returns false after disconnect', async () => {
      const client = new GitHubMCPClient(serverConfig, makeLogger());
      await client.connect();
      await client.disconnect();
      expect(client.isConnected()).toBe(false);
    });
  });

  // ── connect ──────────────────────────────────────────────────────────────

  describe('connect()', () => {
    it('calls client.connect with the transport', async () => {
      const logger = makeLogger();
      const mcpClient = new GitHubMCPClient(serverConfig, logger);
      await mcpClient.connect();

      const instance = getMockClientInstance();
      expect(instance.connect).toHaveBeenCalledTimes(1);
      // transport is an instance of StdioClientTransport
      expect(StdioClientTransport).toHaveBeenCalledTimes(1);
    });

    it('sets isConnected to true', async () => {
      const mcpClient = new GitHubMCPClient(serverConfig, makeLogger());
      await mcpClient.connect();
      expect(mcpClient.isConnected()).toBe(true);
    });

    it('logs info on connect', async () => {
      const logger = makeLogger();
      const mcpClient = new GitHubMCPClient(serverConfig, logger);
      await mcpClient.connect();
      expect(logger.info).toHaveBeenCalled();
    });

    it('is idempotent — second call is a no-op', async () => {
      const mcpClient = new GitHubMCPClient(serverConfig, makeLogger());
      await mcpClient.connect();
      await mcpClient.connect();

      // Client and transport should only be constructed once
      expect(Client).toHaveBeenCalledTimes(1);
      expect(StdioClientTransport).toHaveBeenCalledTimes(1);
    });
  });

  // ── disconnect ───────────────────────────────────────────────────────────

  describe('disconnect()', () => {
    it('sets isConnected to false', async () => {
      const mcpClient = new GitHubMCPClient(serverConfig, makeLogger());
      await mcpClient.connect();
      await mcpClient.disconnect();
      expect(mcpClient.isConnected()).toBe(false);
    });

    it('calls client.close', async () => {
      const mcpClient = new GitHubMCPClient(serverConfig, makeLogger());
      await mcpClient.connect();
      const instance = getMockClientInstance();
      await mcpClient.disconnect();
      expect(instance.close).toHaveBeenCalledTimes(1);
    });

    it('logs info on disconnect', async () => {
      const logger = makeLogger();
      const mcpClient = new GitHubMCPClient(serverConfig, logger);
      await mcpClient.connect();
      vi.clearAllMocks();
      await mcpClient.disconnect();
      expect(logger.info).toHaveBeenCalled();
    });

    it('is idempotent on already-disconnected client', async () => {
      const mcpClient = new GitHubMCPClient(serverConfig, makeLogger());
      // Never connected — should not throw
      await expect(mcpClient.disconnect()).resolves.toBeUndefined();
    });

    it('swallows error from client.close', async () => {
      const mcpClient = new GitHubMCPClient(serverConfig, makeLogger());
      await mcpClient.connect();
      const instance = getMockClientInstance();
      instance.close.mockRejectedValueOnce(new Error('close failed'));

      await expect(mcpClient.disconnect()).resolves.toBeUndefined();
      expect(mcpClient.isConnected()).toBe(false);
    });

    it('logs debug when client.close throws', async () => {
      const logger = makeLogger();
      const mcpClient = new GitHubMCPClient(serverConfig, logger);
      await mcpClient.connect();
      const instance = getMockClientInstance();
      instance.close.mockRejectedValueOnce(new Error('close failed'));
      vi.clearAllMocks();

      await mcpClient.disconnect();
      expect(logger.debug).toHaveBeenCalled();
    });
  });

  // ── callTool ─────────────────────────────────────────────────────────────

  describe('callTool()', () => {
    it('throws when not connected', async () => {
      const mcpClient = new GitHubMCPClient(serverConfig, makeLogger());
      await expect(mcpClient.callTool('search_repositories', {})).rejects.toThrow(
        'MCP client not connected',
      );
    });

    it('passes toolName and args to client.callTool', async () => {
      const mcpClient = new GitHubMCPClient(serverConfig, makeLogger());
      await mcpClient.connect();
      const instance = getMockClientInstance();
      instance.callTool.mockResolvedValueOnce({
        content: [{ type: 'text', text: '{"result": 42}' }],
        isError: false,
      });

      await mcpClient.callTool('search_repositories', { query: 'cadre' });

      expect(instance.callTool).toHaveBeenCalledWith({
        name: 'search_repositories',
        arguments: { query: 'cadre' },
      });
    });

    it('parses JSON text content and returns it', async () => {
      const mcpClient = new GitHubMCPClient(serverConfig, makeLogger());
      await mcpClient.connect();
      const instance = getMockClientInstance();
      instance.callTool.mockResolvedValueOnce({
        content: [{ type: 'text', text: '{"login": "octocat"}' }],
        isError: false,
      });

      const result = await mcpClient.callTool<{ login: string }>('get_me', {});
      expect(result).toEqual({ login: 'octocat' });
    });

    it('throws when isError is true', async () => {
      const mcpClient = new GitHubMCPClient(serverConfig, makeLogger());
      await mcpClient.connect();
      const instance = getMockClientInstance();
      instance.callTool.mockResolvedValueOnce({
        content: [{ type: 'text', text: 'not found' }],
        isError: true,
      });

      await expect(mcpClient.callTool('get_repo', { owner: 'x', repo: 'y' })).rejects.toThrow(
        'MCP tool get_repo failed: not found',
      );
    });

    it('throws when content is empty', async () => {
      const mcpClient = new GitHubMCPClient(serverConfig, makeLogger());
      await mcpClient.connect();
      const instance = getMockClientInstance();
      instance.callTool.mockResolvedValueOnce({
        content: [],
        isError: false,
      });

      await expect(mcpClient.callTool('some_tool', {})).rejects.toThrow(
        'MCP tool some_tool returned no content',
      );
    });

    it('throws when content has no text block', async () => {
      const mcpClient = new GitHubMCPClient(serverConfig, makeLogger());
      await mcpClient.connect();
      const instance = getMockClientInstance();
      instance.callTool.mockResolvedValueOnce({
        content: [{ type: 'image' }],
        isError: false,
      });

      await expect(mcpClient.callTool('some_tool', {})).rejects.toThrow(
        'MCP tool some_tool returned no text content',
      );
    });

    it('returns plain text as-is when JSON.parse throws', async () => {
      const mcpClient = new GitHubMCPClient(serverConfig, makeLogger());
      await mcpClient.connect();
      const instance = getMockClientInstance();
      instance.callTool.mockResolvedValueOnce({
        content: [{ type: 'text', text: 'plain text response' }],
        isError: false,
      });

      const result = await mcpClient.callTool<string>('list_tools', {});
      expect(result).toBe('plain text response');
    });
  });

  // ── checkAuth ────────────────────────────────────────────────────────────

  describe('checkAuth()', () => {
    it('returns true when callTool get_me succeeds', async () => {
      const mcpClient = new GitHubMCPClient(serverConfig, makeLogger());
      await mcpClient.connect();
      const instance = getMockClientInstance();
      instance.callTool.mockResolvedValueOnce({
        content: [{ type: 'text', text: '{"login": "octocat"}' }],
        isError: false,
      });

      const result = await mcpClient.checkAuth();
      expect(result).toBe(true);
    });

    it('returns false when callTool throws', async () => {
      const mcpClient = new GitHubMCPClient(serverConfig, makeLogger());
      await mcpClient.connect();
      const instance = getMockClientInstance();
      instance.callTool.mockRejectedValueOnce(new Error('unauthorized'));

      const result = await mcpClient.checkAuth();
      expect(result).toBe(false);
    });

    it('logs the authenticated username on success', async () => {
      const logger = makeLogger();
      const mcpClient = new GitHubMCPClient(serverConfig, logger);
      await mcpClient.connect();
      const instance = getMockClientInstance();
      instance.callTool.mockResolvedValueOnce({
        content: [{ type: 'text', text: '{"login": "my-bot"}' }],
        isError: false,
      });

      await mcpClient.checkAuth();
      expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('my-bot'));
    });
  });
});
