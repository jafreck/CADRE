import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { Logger } from '../logging/logger.js';

export interface MCPServerConfig {
  /** Command to spawn the GitHub MCP server. */
  command: string;
  /** Arguments for the server command. */
  args: string[];
  /** Environment variables to pass to the server process (GitHub App auth vars). */
  env?: Record<string, string>;
}

/**
 * MCP client that manages a connection to the GitHub MCP server.
 *
 * Replaces all `gh` CLI usage with structured MCP tool calls over JSON-RPC/stdio.
 * The client spawns the MCP server as a subprocess and communicates via stdin/stdout.
 */
export class GitHubMCPClient {
  private client: Client | null = null;
  private transport: StdioClientTransport | null = null;
  private connected = false;

  constructor(
    private readonly serverConfig: MCPServerConfig,
    private readonly logger: Logger,
  ) {}

  /**
   * Connect to the GitHub MCP server.
   * Must be called before any tool calls.
   */
  async connect(): Promise<void> {
    if (this.connected) return;

    this.logger.info('Connecting to GitHub MCP server', {
      data: { command: this.serverConfig.command, args: this.serverConfig.args },
    });

    this.transport = new StdioClientTransport({
      command: this.serverConfig.command,
      args: this.serverConfig.args,
      env: {
        ...process.env,
        ...this.serverConfig.env,
      } as Record<string, string>,
    });

    this.client = new Client({
      name: 'cadre',
      version: '0.1.0',
    });

    await this.client.connect(this.transport);
    this.connected = true;

    this.logger.info('Connected to GitHub MCP server');
  }

  /**
   * Disconnect from the GitHub MCP server and clean up the subprocess.
   */
  async disconnect(): Promise<void> {
    if (!this.connected) return;

    try {
      await this.client?.close();
    } catch (err) {
      this.logger.debug(`MCP client close error (non-critical): ${err}`);
    }

    this.client = null;
    this.transport = null;
    this.connected = false;

    this.logger.info('Disconnected from GitHub MCP server');
  }

  /**
   * Call an MCP tool and return the parsed JSON result.
   * Throws if the tool call fails or returns an error.
   */
  async callTool<T = unknown>(
    toolName: string,
    args: Record<string, unknown>,
  ): Promise<T> {
    if (!this.client || !this.connected) {
      throw new Error('MCP client not connected — call connect() first');
    }

    this.logger.debug(`MCP tool call: ${toolName}`, { data: args });

    const result = await this.client.callTool({
      name: toolName,
      arguments: args,
    });

    // MCP tool results come as content blocks
    const content = result.content as Array<{ type: string; text?: string }>;
    if (!content || content.length === 0) {
      throw new Error(`MCP tool ${toolName} returned no content`);
    }

    // Check for error flag
    if (result.isError) {
      const errorText = content
        .filter((c) => c.type === 'text')
        .map((c) => c.text)
        .join('\n');
      throw new Error(`MCP tool ${toolName} failed: ${errorText}`);
    }

    // Extract text content and parse as JSON
    const textContent = content.find((c) => c.type === 'text');
    if (!textContent?.text) {
      throw new Error(`MCP tool ${toolName} returned no text content`);
    }

    try {
      return JSON.parse(textContent.text) as T;
    } catch {
      // Some tools return plain text (not JSON) — return as-is
      return textContent.text as unknown as T;
    }
  }

  /**
   * Check if the client is currently connected.
   */
  isConnected(): boolean {
    return this.connected;
  }

  /**
   * Verify authentication by calling get_me.
   */
  async checkAuth(): Promise<boolean> {
    try {
      const me = await this.callTool<{ login: string }>('get_me', {});
      this.logger.info(`Authenticated as ${me.login}`);
      return true;
    } catch {
      return false;
    }
  }
}
