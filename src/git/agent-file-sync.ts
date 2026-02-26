import { join, relative } from 'node:path';
import { readFile, writeFile, readdir } from 'node:fs/promises';
import { Logger } from '../logging/logger.js';
import { exists, ensureDir } from '../util/fs.js';
import { AGENT_DEFINITIONS } from '../agents/types.js';

/**
 * Manages syncing agent instruction files into a worktree and bootstrapping
 * the `.cadre/` directory.
 */
export class AgentFileSync {
  constructor(
    private readonly agentDir: string | undefined,
    private readonly backend: string,
    private readonly logger: Logger,
  ) {}

  /**
   * Bootstrap the worktree's `.cadre/` directory and add both `.cadre/` and
   * the backend-specific agent directory to the worktree's private git exclude
   * file (`{git-dir}/info/exclude`) so they are never tracked or accidentally
   * committed — without touching the repo's `.gitignore`.
   */
  async initCadreDir(worktreePath: string, issueNumber: number): Promise<void> {
    const cadreDir = join(worktreePath, '.cadre');
    await ensureDir(cadreDir);

    // Ensure cadre's tasks scratch dir exists too so agents can write there
    await ensureDir(join(cadreDir, 'tasks'));

    // Write exclusions to the worktree-local git exclude instead of .gitignore
    // so the exclusions are never staged or committed.
    try {
      // Use a git instance rooted at the *worktree* so that
      // `git rev-parse --git-dir` returns the worktree's own git-dir path
      // (e.g. /path/to/repo/.git/worktrees/issue-N), not the main repo's `.git`.
      const { simpleGit: makeGit } = await import('simple-git');
      const worktreeGit = makeGit(worktreePath);
      const gitDir = (await worktreeGit.raw(['rev-parse', '--git-dir'])).trim();
      const excludePath = join(
        gitDir.startsWith('/') ? gitDir : join(worktreePath, gitDir),
        'info',
        'exclude',
      );
      await ensureDir(join(excludePath, '..'));
      const { readFile: readFileNode, writeFile } = await import('node:fs/promises');
      const existing = await readFileNode(excludePath, 'utf-8').catch(() => '');
      const existingLines = existing.split('\n').map((l) => l.trim());

      // Entries to protect: cadre state dir + backend-specific agent directory.
      const agentExcludeDir =
        this.backend === 'claude' ? '.claude/agents/' : '.github/agents/';
      const entriesToAdd = ['.cadre/', agentExcludeDir].filter(
        (entry) => !existingLines.some((l) => l === entry),
      );

      if (entriesToAdd.length > 0) {
        const suffix = entriesToAdd.join('\n') + '\n';
        const updated =
          existing === '' || existing.endsWith('\n')
            ? existing + suffix
            : `${existing}\n${suffix}`;
        await writeFile(excludePath, updated, 'utf-8');
        this.logger.debug(
          `Added ${entriesToAdd.join(', ')} to worktree git exclude`,
          { issueNumber },
        );
      }
    } catch {
      // Non-fatal: CommitManager.unstageArtifacts provides the secondary guard.
      this.logger.debug('Could not write worktree git exclude; relying on unstageArtifacts', { issueNumber });
    }
  }

  /**
   * Copy agent files from agentDir into the worktree's agent directory.
   * Source files in agentDir are always plain `{name}.md` with no frontmatter.
   *
   * - **Copilot**: reads `{name}.md`, injects YAML frontmatter, writes
   *   `{name}.agent.md` into `.github/agents/` (the format Copilot CLI expects).
   * - **Claude**: reads `{name}.md`, injects YAML frontmatter, writes
   *   `{name}.md` into `.claude/agents/` (the format Claude CLI expects).
   *
   * No-op if agentDir is not configured or does not exist.
   */
  async syncAgentFiles(worktreePath: string, issueNumber: number): Promise<string[]> {
    if (!this.agentDir) return [];

    if (!(await exists(this.agentDir))) {
      this.logger.debug(`agentDir ${this.agentDir} does not exist — skipping agent sync`, { issueNumber });
      return [];
    }

    const destDir =
      this.backend === 'claude'
        ? join(worktreePath, '.claude', 'agents')
        : join(worktreePath, '.github', 'agents');
    await ensureDir(destDir);

    const entries = await readdir(this.agentDir);
    const sourceFiles = entries.filter((f) => f.endsWith('.md') && !f.endsWith('.agent.md'));
    // Track the exact paths written so CommitManager can precisely unstage them.
    const syncedRelPaths: string[] = [];

    for (const file of sourceFiles) {
      const agentName = file.replace(/\.md$/, '');
      const srcPath = join(this.agentDir!, file);

      const definition = AGENT_DEFINITIONS.find((d) => d.name === agentName);
      const displayName = agentName
        .split('-')
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(' ');
      const description = definition?.description ?? displayName;
      const body = await readFile(srcPath, 'utf-8');

      let destAbsPath: string;
      if (this.backend === 'claude') {
        // Claude expects {name}.md with YAML frontmatter
        const frontmatter = [
          '---',
          `name: ${displayName}`,
          `description: "${description.replace(/"/g, '\\"')}"`,
          '---',
          '',
        ].join('\n');
        destAbsPath = join(destDir, file);
        await writeFile(destAbsPath, frontmatter + body, 'utf-8');
      } else {
        // Copilot expects {name}.agent.md with YAML frontmatter
        const frontmatter = [
          '---',
          `name: ${displayName}`,
          `description: "${description.replace(/"/g, '\\"')}"`,
          'tools: ["read", "edit", "search", "execute"]',
          '---',
          '',
        ].join('\n');
        destAbsPath = join(destDir, `${agentName}.agent.md`);
        await writeFile(destAbsPath, frontmatter + body, 'utf-8');
      }
      syncedRelPaths.push(relative(worktreePath, destAbsPath));
    }

    if (syncedRelPaths.length > 0) {
      this.logger.debug(
        `Synced ${syncedRelPaths.length} agent file(s) from ${this.agentDir} → ${destDir}`,
        { issueNumber },
      );
    }
    return syncedRelPaths;
  }
}
