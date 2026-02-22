import { input, select, confirm } from '@inquirer/prompts';
import { join } from 'node:path';
import { exists } from '../util/fs.js';

// ---------------------------------------------------------------------------
// Exported validators (testable in isolation)
// ---------------------------------------------------------------------------

/** Validates that a project name matches /^[a-z0-9-]+$/ */
export function validateProjectName(value: string): true | string {
  if (/^[a-z0-9-]+$/.test(value)) return true;
  return 'Project name must contain only lowercase letters, digits, and hyphens (no uppercase, spaces, or special characters).';
}

/** Validates that a path has a .git sub-directory */
export async function validateRepoPath(value: string): Promise<true | string> {
  const hasGit = await exists(join(value, '.git'));
  if (hasGit) return true;
  return `No .git directory found at "${value}". Please provide the path to the root of a git repository.`;
}

/** Validates repository format for GitHub ("owner/repo") */
export function validateGitHubRepository(value: string): true | string {
  if (/^[^/]+\/[^/]+$/.test(value)) return true;
  return 'GitHub repository must be in "owner/repo" format.';
}

/** Validates repository format for Azure DevOps ("project/repo" or plain name) */
export function validateAzureDevOpsRepository(value: string): true | string {
  if (value.trim().length > 0) return true;
  return 'Repository name must not be empty.';
}

/** Validates a non-empty string */
export function validateNonEmpty(value: string): true | string {
  if (value.trim().length > 0) return true;
  return 'Value must not be empty.';
}

// ---------------------------------------------------------------------------
// Answers type
// ---------------------------------------------------------------------------

export interface GitHubTokenAuth {
  method: 'token';
  token: string;
}

export interface GitHubAppAuth {
  method: 'app';
  appId: string;
  installationId: string;
  privateKeyFile: string;
}

export type GitHubAuthAnswers = GitHubTokenAuth | GitHubAppAuth;

export interface CommandAnswers {
  install?: string;
  build?: string;
  test?: string;
  lint?: string;
}

export type IssueModeAnswers =
  | { mode: 'ids' }
  | { mode: 'query'; state: 'open' | 'closed' | 'all'; limit: number };

export interface InitAnswers {
  projectName: string;
  platform: 'github' | 'azure-devops';
  repository: string;
  repoPath: string;
  baseBranch: string;
  issueMode: IssueModeAnswers;
  githubAuth?: GitHubAuthAnswers;
  commands: CommandAnswers;
}

// ---------------------------------------------------------------------------
// Prompt helpers
// ---------------------------------------------------------------------------

async function promptGitHubAuth(): Promise<GitHubAuthAnswers> {
  const method = await select<'token' | 'app'>({
    message: 'GitHub authentication method:',
    choices: [
      { name: `Token (uses $GITHUB_TOKEN by default)`, value: 'token' },
      { name: 'GitHub App (appId / installationId / privateKeyFile)', value: 'app' },
    ],
  });

  if (method === 'token') {
    const token = await input({
      message: 'GitHub token (leave blank to use ${GITHUB_TOKEN} at runtime):',
      default: '${GITHUB_TOKEN}',
    });
    return { method: 'token', token };
  }

  const appId = await input({
    message: 'GitHub App ID:',
    validate: validateNonEmpty,
  });
  const installationId = await input({
    message: 'GitHub App installation ID:',
    validate: validateNonEmpty,
  });
  const privateKeyFile = await input({
    message: 'Path to PEM private key file:',
    validate: validateNonEmpty,
  });
  return { method: 'app', appId, installationId, privateKeyFile };
}

async function promptIssueMode(): Promise<IssueModeAnswers> {
  const mode = await select<'ids' | 'query'>({
    message: 'How should CADRE select issues to work on?',
    choices: [
      { name: 'Explicit issue IDs (specified at run time)', value: 'ids' },
      { name: 'Query open issues (up to a limit)', value: 'query' },
    ],
  });

  if (mode === 'ids') return { mode: 'ids' };

  const state = await select<'open' | 'closed' | 'all'>({
    message: 'Issue state to query:',
    choices: [
      { name: 'Open', value: 'open' },
      { name: 'Closed', value: 'closed' },
      { name: 'All', value: 'all' },
    ],
    default: 'open',
  });

  return { mode: 'query', state, limit: 10 };
}

async function promptCommands(yes: boolean): Promise<CommandAnswers> {
  if (yes) return {};

  const wantsCommands = await confirm({
    message: 'Configure build/test commands for the worktree?',
    default: false,
  });
  if (!wantsCommands) return {};

  const install = await input({ message: 'Install command (e.g. npm install):' });
  const build = await input({ message: 'Build command (e.g. npm run build):' });
  const test = await input({ message: 'Test command (e.g. npm test):' });
  const lint = await input({ message: 'Lint command (e.g. npm run lint):' });

  return {
    install: install || undefined,
    build: build || undefined,
    test: test || undefined,
    lint: lint || undefined,
  };
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

/**
 * Interactively collect all answers needed to assemble a CadreConfig.
 * When `yes` is true, non-essential prompts are skipped with defaults.
 * @param yes - skip non-essential prompts and use defaults
 * @param repoPathOverride - pre-supplied repo path (e.g. from --repo-path flag)
 */
export async function collectAnswers(yes: boolean, repoPathOverride?: string): Promise<InitAnswers> {
  const projectName = await input({
    message: 'Project name (lowercase letters, digits, hyphens):',
    validate: validateProjectName,
  });

  const platform = await select<'github' | 'azure-devops'>({
    message: 'Platform:',
    choices: [
      { name: 'GitHub', value: 'github' },
      { name: 'Azure DevOps', value: 'azure-devops' },
    ],
  });

  const repository = await input({
    message:
      platform === 'github'
        ? 'Repository (owner/repo):'
        : 'Repository (project/repo or plain name):',
    validate:
      platform === 'github' ? validateGitHubRepository : validateAzureDevOpsRepository,
  });

  const repoPath = yes
    ? (repoPathOverride ?? process.cwd())
    : await input({
        message: 'Path to local git repository:',
        default: repoPathOverride ?? process.cwd(),
        validate: validateRepoPath,
      });

  const baseBranch = yes
    ? 'main'
    : await input({
        message: 'Base branch:',
        default: 'main',
        validate: validateNonEmpty,
      });

  const issueMode: IssueModeAnswers = yes
    ? { mode: 'query', state: 'open', limit: 10 }
    : await promptIssueMode();

  let githubAuth: GitHubAuthAnswers | undefined;
  if (platform === 'github' && !yes) {
    githubAuth = await promptGitHubAuth();
  }

  const commands = await promptCommands(yes);

  return {
    projectName,
    platform,
    repository,
    repoPath,
    baseBranch,
    issueMode,
    githubAuth,
    commands,
  };
}
