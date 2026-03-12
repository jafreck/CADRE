import { join } from 'node:path';
import { exec } from '../../util/process.js';
import type { Logger } from '@cadre-dev/framework/core';
import type { CadreConfig } from '../../config/schema.js';

/** Relative path within a worktree where the Lore SQLite DB is stored. */
export const LORE_DB_REL_PATH = join('.cadre', 'lore.db');

export interface LoreConfig {
  enabled: boolean;
  command: string;
  indexArgs: string[];
  serveArgs: string[];
  indexTimeout: number;
}

/**
 * Resolve the lore config from the cadre config.
 * Returns a fully resolved config with defaults applied.
 */
export function resolveLoreConfig(config: CadreConfig): LoreConfig {
  const lore = config.lore;
  return {
    enabled: lore?.enabled ?? false,
    command: lore?.command ?? 'lore',
    indexArgs: lore?.indexArgs ?? [],
    serveArgs: lore?.serveArgs ?? ['mcp'],
    indexTimeout: lore?.indexTimeout ?? 120_000,
  };
}

/**
 * Builds a Lore knowledge-base index for a worktree.
 *
 * The index is built once per issue by running:
 *
 *   lore index --root <worktreePath> --db <worktreePath>/.cadre/lore.db
 *
 * before any agents are launched.  This populates the Lore database so
 * agents can make fast, targeted queries via the Lore MCP server instead
 * of reading full files.
 */
export class LoreIndexBuilder {
  constructor(
    private readonly loreConfig: LoreConfig,
    private readonly logger: Logger,
  ) {}

  /**
   * Build (or refresh) the Lore index for the given worktree.
   *
   * @param worktreePath  Absolute path to the worktree root.
   * @param issueNumber   Issue number for structured logging.
   * @returns `true` if indexing succeeded, `false` otherwise (non-fatal).
   */
  async buildIndex(worktreePath: string, issueNumber: number): Promise<boolean> {
    if (!this.loreConfig.enabled) return false;

    this.logger.info('Building Lore index for worktree', {
      workItemId: String(issueNumber),
      data: { worktreePath },
    });

    const dbPath = join(worktreePath, LORE_DB_REL_PATH);
    const args = ['index', '--root', worktreePath, '--db', dbPath, ...this.loreConfig.indexArgs];
    const startTime = Date.now();

    try {
      const result = await exec(this.loreConfig.command, args, {
        cwd: worktreePath,
        timeout: this.loreConfig.indexTimeout,
      });

      const duration = Date.now() - startTime;

      if (result.exitCode !== 0) {
        this.logger.warn(
          `Lore index build failed (exit ${result.exitCode}): ${result.stderr}`,
          { workItemId: String(issueNumber), data: { duration, exitCode: result.exitCode } },
        );
        return false;
      }

      this.logger.info(`Lore index built in ${duration}ms`, {
        workItemId: String(issueNumber),
        data: { duration },
      });
      return true;
    } catch (err) {
      const duration = Date.now() - startTime;
      this.logger.warn(
        `Lore index build error: ${err}`,
        { workItemId: String(issueNumber), data: { duration } },
      );
      return false;
    }
  }
}
