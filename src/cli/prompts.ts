import { input, select, confirm } from '@inquirer/prompts';
import { access } from 'node:fs/promises';
import { join } from 'node:path';
import { simpleGit } from 'simple-git';

export interface PromptAnswers {
  projectName: string;
  platform: 'github' | 'azure-devops';
  repository: string;
  repoPath: string;
  baseBranch: string;
  issueMode: 'ids' | 'query';
  commands: {
    install?: string;
    build?: string;
    test?: string;
    lint?: string;
  };
  githubAuthMethod: 'token' | 'github-app' | 'auto-detect';
}

/** Derive owner/repo from a git remote URL. */
function parseRemoteUrl(remoteUrl: string): string | null {
  // Handle both SSH (git@github.com:owner/repo.git) and HTTPS formats
  const sshMatch = remoteUrl.match(/[^:]+:([^/]+\/[^/]+?)(?:\.git)?$/);
  const httpsMatch = remoteUrl.match(/github\.com\/([^/]+\/[^/]+?)(?:\.git)?$/);
  const match = httpsMatch ?? sshMatch;
  return match ? match[1] : null;
}

async function tryGetRemoteInfo(repoPath: string): Promise<{ repository: string | null; projectName: string | null }> {
  try {
    const git = simpleGit(repoPath);
    const remotes = await git.getRemotes(true);
    const origin = remotes.find((r) => r.name === 'origin') ?? remotes[0];
    if (!origin) return { repository: null, projectName: null };

    const repository = parseRemoteUrl(origin.refs.fetch ?? '');
    const projectName = repository ? repository.split('/')[1]?.replace(/[^a-z0-9-]/g, '-').toLowerCase() ?? null : null;
    return { repository, projectName };
  } catch {
    return { repository: null, projectName: null };
  }
}

async function gitDirExists(repoPath: string): Promise<boolean> {
  try {
    await access(join(repoPath, '.git'));
    return true;
  } catch {
    return false;
  }
}

export async function runPrompts(opts: { yes: boolean }): Promise<PromptAnswers> {
  const cwd = process.cwd();

  if (opts.yes) {
    const { repository, projectName } = await tryGetRemoteInfo(cwd);

    if (!repository) {
      console.warn('Warning: Could not derive repository from git remote. Using empty string.');
    }
    if (!projectName) {
      console.warn('Warning: Could not derive project name from git remote. Using empty string.');
    }

    return {
      projectName: projectName ?? '',
      platform: 'github',
      repository: repository ?? '',
      repoPath: cwd,
      baseBranch: 'main',
      issueMode: 'query',
      commands: {},
      githubAuthMethod: 'auto-detect',
    };
  }

  const projectName = await input({
    message: 'Project name:',
    validate: (v) => /^[a-z0-9-]+$/.test(v) || 'Must match /^[a-z0-9-]+$/ (lowercase letters, numbers, hyphens)',
  });

  const platform = await select<'github' | 'azure-devops'>({
    message: 'Platform:',
    choices: [
      { value: 'github', name: 'GitHub' },
      { value: 'azure-devops', name: 'Azure DevOps' },
    ],
  });

  const repository = await input({
    message: platform === 'github' ? 'Repository (owner/repo):' : 'Repository:',
    validate: (v) => {
      if (platform === 'github') {
        return /^[^/]+\/[^/]+$/.test(v) || 'Must be in owner/repo format';
      }
      return v.trim().length > 0 || 'Repository cannot be empty';
    },
  });

  const repoPath = await input({
    message: 'Local repo path:',
    default: cwd,
    validate: async (v) => {
      const exists = await gitDirExists(v);
      return exists || `No .git directory found at ${v}`;
    },
  });

  const baseBranch = await input({
    message: 'Base branch:',
    default: 'main',
  });

  const issueMode = await select<'ids' | 'query'>({
    message: 'Issue selection mode:',
    choices: [
      { value: 'query', name: 'Query (labels, milestone, assignee)' },
      { value: 'ids', name: 'Specific issue IDs' },
    ],
  });

  const wantInstall = await confirm({ message: 'Specify an install command?', default: false });
  const installCmd = wantInstall ? await input({ message: 'Install command:' }) : undefined;

  const wantBuild = await confirm({ message: 'Specify a build command?', default: false });
  const buildCmd = wantBuild ? await input({ message: 'Build command:' }) : undefined;

  const wantTest = await confirm({ message: 'Specify a test command?', default: false });
  const testCmd = wantTest ? await input({ message: 'Test command:' }) : undefined;

  const wantLint = await confirm({ message: 'Specify a lint command?', default: false });
  const lintCmd = wantLint ? await input({ message: 'Lint command:' }) : undefined;

  const githubAuthMethod = platform === 'github'
    ? await select<'token' | 'github-app' | 'auto-detect'>({
        message: 'GitHub auth method:',
        choices: [
          { value: 'auto-detect', name: 'Auto-detect (GITHUB_TOKEN env var)' },
          { value: 'token', name: 'Personal access token' },
          { value: 'github-app', name: 'GitHub App' },
        ],
      })
    : 'auto-detect';

  return {
    projectName,
    platform,
    repository,
    repoPath,
    baseBranch,
    issueMode,
    commands: {
      install: installCmd,
      build: buildCmd,
      test: testCmd,
      lint: lintCmd,
    },
    githubAuthMethod,
  };
}
