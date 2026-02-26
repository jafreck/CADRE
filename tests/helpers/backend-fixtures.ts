import type { AgentInvocation } from '../../src/agents/types.js';
import { makeRuntimeConfig } from './make-runtime-config.js';

export function makeProcessResult(overrides: Partial<{
  exitCode: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}> = {}) {
  return {
    exitCode: overrides.exitCode ?? 0,
    stdout: overrides.stdout ?? '',
    stderr: overrides.stderr ?? '',
    signal: null,
    timedOut: overrides.timedOut ?? false,
  };
}

export function makeConfig(overrides: Partial<{
  cliCommand: string;
  agentDir: string;
  model: string;
  timeout: number;
  extraPath: string[];
  claudeCli: string;
}> = {}) {
  return makeRuntimeConfig({
    copilot: {
      cliCommand: overrides.cliCommand ?? 'copilot',
      model: 'claude-sonnet-4.6',
      agentDir: overrides.agentDir ?? '.github/agents',
      timeout: overrides.timeout ?? 300_000,
    },
    agent: {
      backend: 'copilot' as const,
      model: overrides.model,
      timeout: overrides.timeout ?? 300_000,
      copilot: {
        cliCommand: overrides.cliCommand ?? 'copilot',
        agentDir: overrides.agentDir ?? '.github/agents',
      },
      claude: {
        cliCommand: overrides.claudeCli ?? 'claude',
        agentDir: overrides.agentDir ?? '.github/agents',
      },
    },
    environment: {
      inheritShellPath: true,
      extraPath: overrides.extraPath ?? [],
    },
  });
}

export function makeInvocation(overrides: Partial<AgentInvocation> = {}): AgentInvocation {
  return {
    agent: 'code-writer',
    issueNumber: 42,
    phase: 3,
    sessionId: 'session-001',
    contextPath: '/tmp/worktree/.cadre/issues/42/contexts/ctx.json',
    outputPath: '/tmp/worktree/.cadre/issues/42/outputs/result.md',
    ...overrides,
  };
}
