import { resolve, join } from 'node:path';
import { stat } from 'node:fs/promises';
import type { AgentInvocation, AgentResult } from '../context/types.js';
import type { BackendRuntimeConfig, BackendLoggerLike, AgentBackend } from '../backend/backend.js';
import { createAgentBackend } from '../backend/factory.js';

/** Metadata describing a single agent (for validateAgentFiles). */
export interface AgentDefinitionLike {
  name: string;
}

async function statOrNull(filePath: string): Promise<{ size: number } | null> {
  try {
    return await stat(filePath);
  } catch {
    return null;
  }
}

/**
 * Spawns agent invocations as headless child processes via the configured backend.
 */
export class AgentLauncher {
  private readonly backend: AgentBackend;

  constructor(
    private readonly config: BackendRuntimeConfig,
    private readonly logger: BackendLoggerLike,
  ) {
    this.backend = createAgentBackend(config, logger);
  }

  /**
   * Validate that all agent instruction files exist and are non-empty.
   * Returns an array of error strings for any missing or empty files.
   * Copilot backend expects `{name}.agent.md`; Claude expects `{name}.md`.
   */
  static async validateAgentFiles(agentDir: string, agentDefinitions: readonly AgentDefinitionLike[]): Promise<string[]> {
    const resolvedDir = resolve(agentDir);
    const issues: string[] = [];
    for (const agent of agentDefinitions) {
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
