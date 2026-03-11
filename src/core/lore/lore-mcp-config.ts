import { join } from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';
import type { Logger } from '@cadre-dev/framework/core';
import { ensureDir, exists } from '../../util/fs.js';
import { type LoreConfig, LORE_DB_REL_PATH } from './lore-index-builder.js';

/**
 * Writes MCP server configuration for the Lore knowledge-base tool into
 * agent worktrees so the Claude / Copilot CLIs will automatically discover
 * and start the Lore MCP server when an agent is invoked.
 *
 * - **Claude backend**: writes to `{worktree}/.claude/settings.local.json`
 * - **Copilot backend**: writes to `{worktree}/.github/copilot/mcp.json`
 *
 * The config files point at the worktree-specific Lore index so each issue
 * pipeline queries its own snapshot of the codebase.
 */
export class LoreMcpConfigWriter {
  constructor(
    private readonly loreConfig: LoreConfig,
    private readonly backend: string,
    private readonly logger: Logger,
  ) {}

  /**
   * Write or merge the Lore MCP server entry into the worktree's CLI-specific
   * MCP configuration file.
   *
   * Non-destructive: if a config file already exists, the lore entry is merged
   * into the existing `mcpServers` map without overwriting other servers.
   *
   * @param worktreePath  Absolute path to the worktree root.
   * @param issueNumber   Issue number for structured logging.
   */
  async writeMcpConfig(worktreePath: string, issueNumber: number): Promise<void> {
    if (!this.loreConfig.enabled) return;

    if (this.backend === 'claude') {
      await this.writeClaudeConfig(worktreePath, issueNumber);
    } else {
      await this.writeCopilotConfig(worktreePath, issueNumber);
    }
  }

  // ── Claude ──

  /**
   * Write `{worktree}/.claude/settings.local.json` with Lore MCP server.
   *
   * Claude CLI reads this file automatically. Using `settings.local.json`
   * instead of `settings.json` avoids clobbering user settings if they
   * exist in the worktree already.
   */
  private async writeClaudeConfig(worktreePath: string, issueNumber: number): Promise<void> {
    const configDir = join(worktreePath, '.claude');
    await ensureDir(configDir);
    const configPath = join(configDir, 'settings.local.json');

    const dbPath = join(worktreePath, LORE_DB_REL_PATH);
    const loreMcpEntry = {
      command: this.loreConfig.command,
      args: [...this.loreConfig.serveArgs, '--db', dbPath],
    };

    let config: Record<string, unknown> = {};
    if (await exists(configPath)) {
      try {
        const raw = await readFile(configPath, 'utf-8');
        config = JSON.parse(raw) as Record<string, unknown>;
      } catch {
        // Malformed JSON — start fresh.
      }
    }

    const mcpServers = (config['mcpServers'] ?? {}) as Record<string, unknown>;
    mcpServers['lore'] = loreMcpEntry;
    config['mcpServers'] = mcpServers;

    await writeFile(configPath, JSON.stringify(config, null, 2) + '\n', 'utf-8');

    this.logger.debug('Wrote Lore MCP config for Claude backend', {
      workItemId: String(issueNumber),
      data: { configPath },
    });
  }

  // ── Copilot ──

  /**
   * Write `{worktree}/.github/copilot/mcp.json` with Lore MCP server.
   *
   * Copilot CLI reads this file for MCP server discovery.
   */
  private async writeCopilotConfig(worktreePath: string, issueNumber: number): Promise<void> {
    const configDir = join(worktreePath, '.github', 'copilot');
    await ensureDir(configDir);
    const configPath = join(configDir, 'mcp.json');

    const dbPath = join(worktreePath, LORE_DB_REL_PATH);
    const loreMcpEntry = {
      command: this.loreConfig.command,
      args: [...this.loreConfig.serveArgs, '--db', dbPath],
    };

    let config: Record<string, unknown> = {};
    if (await exists(configPath)) {
      try {
        const raw = await readFile(configPath, 'utf-8');
        config = JSON.parse(raw) as Record<string, unknown>;
      } catch {
        // Malformed JSON — start fresh.
      }
    }

    const mcpServers = (config['mcpServers'] ?? {}) as Record<string, unknown>;
    mcpServers['lore'] = loreMcpEntry;
    config['mcpServers'] = mcpServers;

    await writeFile(configPath, JSON.stringify(config, null, 2) + '\n', 'utf-8');

    this.logger.debug('Wrote Lore MCP config for Copilot backend', {
      workItemId: String(issueNumber),
      data: { configPath },
    });
  }
}
