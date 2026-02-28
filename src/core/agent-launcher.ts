import { AGENT_DEFINITIONS } from '../agents/types.js';
import type { AgentInvocation, AgentResult } from '../agents/types.js';
import { AgentLauncher as _AgentLauncher } from '@cadre/agent-runtime';
export type { AgentDefinitionLike } from '@cadre/agent-runtime';

/**
 * Spawns agent invocations as headless child processes via the configured backend.
 * Wraps @cadre/agent-runtime AgentLauncher with CADRE-specific AGENT_DEFINITIONS.
 */
export class AgentLauncher extends _AgentLauncher {
  /**
   * Validate that all agent instruction files exist and are non-empty.
   * Uses the CADRE AGENT_DEFINITIONS registry.
   */
  static override async validateAgentFiles(agentDir: string): Promise<string[]> {
    return _AgentLauncher.validateAgentFiles(agentDir, AGENT_DEFINITIONS);
  }

  /**
   * Launch an agent in the context of a specific worktree.
   * Narrows return type to CADRE AgentResult.
   */
  override async launchAgent(invocation: AgentInvocation, worktreePath: string): Promise<AgentResult> {
    return super.launchAgent(invocation, worktreePath) as Promise<AgentResult>;
  }
}
