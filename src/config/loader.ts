import { readFile } from 'node:fs/promises';
import { resolve, isAbsolute } from 'node:path';
import { CadreConfigSchema, type CadreConfig } from './schema.js';
import { exists } from '../util/fs.js';

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
export async function loadConfig(configPath: string): Promise<Readonly<CadreConfig>> {
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

  // Synthesize agent config from legacy copilot config if agent is not set
  const agent = config.agent ?? {
    backend: 'copilot' as const,
    model: config.copilot.model,
    timeout: config.copilot.timeout,
    copilot: {
      cliCommand: config.copilot.cliCommand,
      agentDir: config.copilot.agentDir,
      costOverrides: config.copilot.costOverrides,
    },
    claude: { cliCommand: 'claude', agentDir: '.claude/agents' },
  };

  // Resolve relative paths to absolute
  const resolvedRepoPath = isAbsolute(config.repoPath)
    ? config.repoPath
    : resolve(process.cwd(), config.repoPath);

  const resolvedWorktreeRoot = config.worktreeRoot
    ? isAbsolute(config.worktreeRoot)
      ? config.worktreeRoot
      : resolve(resolvedRepoPath, config.worktreeRoot)
    : resolve(resolvedRepoPath, '.cadre', 'worktrees');

  // Validate repoPath is a git repository
  const gitDir = resolve(resolvedRepoPath, '.git');
  if (!(await exists(gitDir))) {
    throw new ConfigLoadError(
      `repoPath is not a git repository: ${resolvedRepoPath} (no .git directory found)`,
    );
  }

  const frozen: CadreConfig = {
    ...config,
    repoPath: resolvedRepoPath,
    worktreeRoot: resolvedWorktreeRoot,
    agent,
  };

  return Object.freeze(frozen);
}

/**
 * Apply CLI overrides to a loaded config.
 */
export function applyOverrides(
  config: CadreConfig,
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
): CadreConfig {
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

  return Object.freeze(merged);
}
