import { readFile } from 'node:fs/promises';
import { resolve, isAbsolute, join } from 'node:path';
import { homedir } from 'node:os';
import { CadreConfigSchema, type CadreConfig } from './schema.js';
import { exists } from '../util/fs.js';

/**
 * Config as consumed by the runtime: all fields that loadConfig always
 * synthesises are narrowed to required. Everything else is inherited as-is.
 */
export interface RuntimeConfig extends Omit<CadreConfig, 'stateDir' | 'worktreeRoot' | 'agent'> {
  /** Always an absolute path — resolved by loadConfig. */
  readonly stateDir: string;
  /** Always an absolute path — resolved by loadConfig. */
  readonly worktreeRoot: string;
  /** Always synthesised from copilot legacy fields if absent. */
  readonly agent: NonNullable<CadreConfig['agent']>;
}

export class ConfigLoadError extends Error {
  constructor(
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ConfigLoadError';
  }
}

/**
 * Load, parse, and validate a cadre.config.json file.
 * Resolves relative paths to absolute and validates the repo is a git repository.
 */
export async function loadConfig(configPath: string): Promise<RuntimeConfig> {
  const absPath = isAbsolute(configPath) ? configPath : resolve(process.cwd(), configPath);

  // Check file exists
  if (!(await exists(absPath))) {
    throw new ConfigLoadError(`Config file not found: ${absPath}`);
  }

  // Read and parse JSON
  let raw: unknown;
  try {
    const content = await readFile(absPath, 'utf-8');
    raw = JSON.parse(content);
  } catch (err) {
    throw new ConfigLoadError(`Failed to parse config file: ${absPath}`, err);
  }

  // Validate with Zod
  const result = CadreConfigSchema.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new ConfigLoadError(`Invalid config:\n${issues}`, result.error);
  }

  const config = result.data;

  // Resolve relative paths to absolute
  const resolvedRepoPath = isAbsolute(config.repoPath)
    ? config.repoPath
    : resolve(process.cwd(), config.repoPath);

  // stateDir: all cadre state lives outside the target repo so it never pollutes git
  const resolvedStateDir = config.stateDir
    ? isAbsolute(config.stateDir)
      ? config.stateDir
      : resolve(process.cwd(), config.stateDir)
    : join(homedir(), '.cadre', config.projectName);

  const resolvedWorktreeRoot = config.worktreeRoot
    ? isAbsolute(config.worktreeRoot)
      ? config.worktreeRoot
      : resolve(resolvedRepoPath, config.worktreeRoot)
    : join(resolvedStateDir, 'worktrees');

  /**
   * Resolve an agent directory path.
   *
   * - Absolute paths are returned unchanged.
   * - Paths starting with `.cadre/` or `.claude/` are legacy in-repo state paths; the prefix is
   *   stripped and the remainder is resolved under `stateDir` (backwards compatibility).
   * - Simple bare names (e.g. `agents`, the new default) resolve under `stateDir`.
   * - Any other relative path (e.g. `.github/agents`) is assumed to be repo-relative and resolves
   *   against `repoPath`, since directories like `.github/` are tracked by git.
   */
  function resolveAgentDir(agentDir: string): string {
    if (isAbsolute(agentDir)) return agentDir;
    if (agentDir.startsWith('.cadre/')) {
      return join(resolvedStateDir, agentDir.slice('.cadre/'.length));
    }
    if (agentDir.startsWith('.claude/')) {
      return join(resolvedStateDir, agentDir.slice('.claude/'.length));
    }
    // Bare name with no path separator → stateDir (e.g. the default "agents")
    if (!agentDir.includes('/')) {
      return join(resolvedStateDir, agentDir);
    }
    // Everything else (e.g. `.github/agents`) is repo-relative
    return join(resolvedRepoPath, agentDir);
  }

  // Synthesize agent config from legacy copilot config if agent is not set
  const agent = config.agent ?? {
    backend: 'copilot' as const,
    model: config.copilot.model,
    timeout: config.copilot.timeout,
    copilot: {
      cliCommand: config.copilot.cliCommand,
      agentDir: resolveAgentDir(config.copilot.agentDir),
      costOverrides: config.copilot.costOverrides,
    },
    claude: { cliCommand: 'claude', agentDir: join(resolvedStateDir, 'agents') },
  };

  // Validate repoPath is a git repository
  const gitDir = resolve(resolvedRepoPath, '.git');
  if (!(await exists(gitDir))) {
    throw new ConfigLoadError(
      `repoPath is not a git repository: ${resolvedRepoPath} (no .git directory found)`,
    );
  }

  const frozen: RuntimeConfig = {
    ...config,
    repoPath: resolvedRepoPath,
    stateDir: resolvedStateDir,
    worktreeRoot: resolvedWorktreeRoot,
    copilot: {
      ...config.copilot,
      agentDir: resolveAgentDir(config.copilot.agentDir),
    },
    agent,
  };

  return Object.freeze(frozen);
}

/**
 * Apply CLI overrides to a loaded config.
 */
export function applyOverrides(
  config: RuntimeConfig,
  overrides: {
    resume?: boolean;
    dryRun?: boolean;
    issue?: number;
    maxParallelIssues?: number;
    issueIds?: number[];
    skipValidation?: boolean;
    noPr?: boolean;
    respondToReviews?: boolean;
  },
): RuntimeConfig {
  const merged = { ...config };

  if (overrides.resume != null) {
    merged.options = { ...merged.options, resume: overrides.resume };
  }

  if (overrides.dryRun != null) {
    merged.options = { ...merged.options, dryRun: overrides.dryRun };
  }

  if (overrides.issue != null) {
    merged.issues = { ids: [overrides.issue] };
  }

  if (overrides.issueIds && overrides.issueIds.length > 0) {
    merged.issues = { ids: overrides.issueIds };
  }

  if (overrides.maxParallelIssues != null) {
    merged.options = { ...merged.options, maxParallelIssues: overrides.maxParallelIssues };
  }

  if (overrides.skipValidation != null) {
    merged.options = { ...merged.options, skipValidation: overrides.skipValidation };
  }

  if (overrides.noPr != null) {
    merged.pullRequest = { ...merged.pullRequest, autoCreate: !overrides.noPr };
  }

  if (overrides.respondToReviews != null) {
    merged.options = { ...merged.options, respondToReviews: overrides.respondToReviews };
  }

  return Object.freeze(merged) as RuntimeConfig;
}
