import { resolve, join } from 'node:path';
import type { CadreConfig } from '../config/schema.js';
import type { AgentInvocation, AgentResult } from '../agents/types.js';
import { AGENT_DEFINITIONS } from '../agents/types.js';
import { statOrNull } from '../util/fs.js';
import { Logger } from '../logging/logger.js';
import { type AgentBackend } from '../agents/backend.js';
import { createAgentBackend } from '../agents/backend-factory.js';

/**
 * Spawns agent invocations as headless child processes via the configured backend.
 */
export class AgentLauncher {
  private readonly backend: AgentBackend;

  constructor(
    private readonly config: CadreConfig,
    private readonly logger: Logger,
  ) {
    this.backend = createAgentBackend(config, logger);
  }

  /**
   * Validate that all agent instruction files exist and are non-empty.
   * Returns an array of error strings for any missing or empty files.
   * Copilot backend expects `{name}.agent.md`; Claude expects `{name}.md`.
   */
  static async validateAgentFiles(agentDir: string): Promise<string[]> {
    const resolvedDir = resolve(agentDir);
    const issues: string[] = [];
    for (const agent of AGENT_DEFINITIONS) {
      // agentDir always stores plain {name}.md source files.
      const filePath = join(resolvedDir, `${agent.name}.md`);
      const fileStat = await statOrNull(filePath);
      if (fileStat === null) {
        issues.push(`  ❌ Missing: ${filePath}`);
      } else if (fileStat.size === 0) {
        issues.push(`  ❌ Empty:   ${filePath}`);
      }
    }
    return issues;
  }

  /**
   * Validate that the backend is ready (e.g., CLI available).
   */
  async init(): Promise<void> {
    await this.backend.init();
  }

  /**
   * Launch an agent in the context of a specific worktree.
   */
  async launchAgent(invocation: AgentInvocation, worktreePath: string): Promise<AgentResult> {
    return this.backend.invoke(invocation, worktreePath);
  }
}
