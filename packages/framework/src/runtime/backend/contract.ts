import type { AgentInvocation, AgentResult } from '../context/types.js';
import type { LoggerLike } from '../retry/retry.js';

export type BackendOptions = Record<string, unknown>;

export type CopilotEffortLevel = 'low' | 'medium' | 'high' | 'xhigh';

export interface BackendLoggerLike extends LoggerLike {
  debug(message: string, context?: Record<string, unknown>): void;
}

export interface BackendAgentConfig {
  backend: string;
  model?: string;
  timeout?: number;
  backends?: Record<string, BackendOptions | undefined>;
  copilot?: BackendOptions & {
    cliCommand?: string;
    agentDir?: string;
    costOverrides?: Record<string, unknown>;
    /** Pass --effort to the Copilot CLI. When omitted, the CLI default is used. */
    effort?: CopilotEffortLevel;
    /** Pass --allow-all-tools to the Copilot CLI. Must be explicitly enabled. */
    allowAllTools?: boolean;
    /** Pass --allow-all-paths to the Copilot CLI. Must be explicitly enabled. */
    allowAllPaths?: boolean;
  };
  claude?: BackendOptions & {
    cliCommand?: string;
    agentDir?: string;
    /** Comma-separated tool names for --allowedTools. When omitted, --allowedTools is not passed. */
    allowedTools?: string;
  };
}

export interface BackendRuntimeConfig {
  agent: BackendAgentConfig;
  copilot?: {
    timeout: number;
  };
  environment: {
    extraPath: string[];
  };
}

export interface AgentBackend {
  name: string;
  init(): Promise<void>;
  invoke(invocation: AgentInvocation, worktreePath: string): Promise<AgentResult>;
}

export type BackendFactory = (config: BackendRuntimeConfig, logger: BackendLoggerLike) => AgentBackend;

export function normalizeAgentBackendName(name: string): string {
  return name.trim().toLowerCase();
}

export function ensureValidAgentBackendName(name: string, context: string): string {
  const normalized = normalizeAgentBackendName(name);
  if (!normalized) {
    throw new Error(`Agent backend ${context} must be a non-empty string.`);
  }
  return normalized;
}

function assertBackendOptionsShape(backendName: string, source: string, options: unknown): asserts options is BackendOptions {
  if (options === undefined) {
    return;
  }
  if (options === null || Array.isArray(options) || typeof options !== 'object') {
    throw new Error(`Agent backend "${backendName}" ${source} options must be an object when provided.`);
  }
}

export function getAgentBackendOptions<TOptions extends object = BackendOptions>(
  config: BackendRuntimeConfig,
  backendName: string,
): TOptions | undefined {
  const normalizedName = ensureValidAgentBackendName(backendName, 'name');
  const explicit = config.agent.backends?.[normalizedName];
  const builtin = normalizedName === 'copilot'
    ? config.agent.copilot
    : normalizedName === 'claude'
      ? config.agent.claude
      : undefined;

  assertBackendOptionsShape(normalizedName, 'generic', explicit);
  assertBackendOptionsShape(normalizedName, 'built-in', builtin);

  if (explicit && builtin) {
    return { ...builtin, ...explicit } as TOptions;
  }

  return (explicit ?? builtin) as TOptions | undefined;
}