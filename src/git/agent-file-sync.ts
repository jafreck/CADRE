import { join, relative } from 'node:path';
import { readFile, writeFile, readdir, symlink, unlink, lstat } from 'node:fs/promises';
import { Logger } from '@cadre-dev/framework/core';
import { exists, ensureDir } from '../util/fs.js';
import { AGENT_DEFINITIONS } from '../agents/types.js';

/**
 * Manages syncing agent instruction files into a worktree and bootstrapping
 * the `.cadre/` directory.
 *
 * Agent files are **not** copied into each worktree.  Instead, frontmatter-
 * enriched versions are generated once into a shared cache directory
 * (`{stateDir}/agents-cache-{backend}/`) and each worktree receives symlinks
 * pointing to the cache.  This means N concurrent worktrees share a single
 * set of enriched agent files with zero duplication.
 */
export class AgentFileSync {
  /** Absolute path to the shared agent-file cache for this backend. */
  private readonly cacheDir: string | undefined;

  constructor(
    private readonly agentDir: string | undefined,
    private readonly backend: string,
    private readonly logger: Logger,
    stateDir?: string,
  ) {
    this.cacheDir = stateDir
      ? join(stateDir, `agents-cache-${backend}`)
      : undefined;
  }

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
   * Build (or refresh) the shared agent-file cache.  For each plain
   * `{name}.md` in `agentDir`, generate the backend-specific enriched
   * version (with YAML frontmatter) and write it once to `cacheDir`.
   *
   * Subsequent worktree syncs create symlinks to these cached files
   * instead of duplicating them.
   *
   * No-op when `agentDir` or `cacheDir` is unset, or the source dir
   * does not exist on disk.
   */
  async buildAgentCache(): Promise<void> {
    if (!this.agentDir || !this.cacheDir) return;
    if (!(await exists(this.agentDir))) return;

    await ensureDir(this.cacheDir);

    const entries = await readdir(this.agentDir);
    const sourceFiles = entries.filter((f) => f.endsWith('.md') && !f.endsWith('.agent.md'));

    for (const file of sourceFiles) {
      const agentName = file.replace(/\.md$/, '');
      const srcPath = join(this.agentDir, file);

      const definition = AGENT_DEFINITIONS.find((d) => d.name === agentName);
      const displayName = agentName
        .split('-')
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(' ');
      const description = definition?.description ?? displayName;
      const body = await readFile(srcPath, 'utf-8');

      let destFileName: string;
      let content: string;

      if (this.backend === 'claude') {
        const frontmatter = [
          '---',
          `name: ${displayName}`,
          `description: "${description.replace(/"/g, '\\"')}"`,
          '---',
          '',
        ].join('\n');
        destFileName = file;
        content = frontmatter + body;
      } else {
        const frontmatter = [
          '---',
          `name: ${displayName}`,
          `description: "${description.replace(/"/g, '\\"')}"`,
          'tools: ["read", "edit", "search", "execute"]',
          '---',
          '',
        ].join('\n');
        destFileName = `${agentName}.agent.md`;
        content = frontmatter + body;
      }

      await writeFile(join(this.cacheDir, destFileName), content, 'utf-8');
    }

    this.logger.debug(
      `Built agent cache (${sourceFiles.length} file(s)) in ${this.cacheDir}`,
    );
  }

  /**
   * Symlink cached agent files into the worktree's backend-specific agent
   * directory.  Source files live in the shared cache (`buildAgentCache`
   * must be called first).
   *
   * - **Copilot**: `.github/agents/{name}.agent.md` → cache
   * - **Claude**: `.claude/agents/{name}.md` → cache
   *
   * Existing symlinks are replaced; regular files that collide with a
   * cache entry are left untouched (the target repo may have its own agent
   * files) and will not appear in the returned list.
   *
   * Returns worktree-relative paths of untracked symlinks created, matching
   * the contract expected by `CommitManager.unstageArtifacts`.
   *
   * No-op if cacheDir is not configured or does not exist.
   */
  async syncAgentFiles(worktreePath: string, issueNumber: number): Promise<string[]> {
    if (!this.cacheDir) {
      return [];
    }

    if (!(await exists(this.cacheDir))) {
      this.logger.debug(
        `Agent cache ${this.cacheDir} does not exist — skipping agent sync (run buildAgentCache first)`,
        { issueNumber },
      );
      return [];
    }

    const destDir =
      this.backend === 'claude'
        ? join(worktreePath, '.claude', 'agents')
        : join(worktreePath, '.github', 'agents');
    await ensureDir(destDir);

    const cacheFiles = await readdir(this.cacheDir);
    const syncedRelPaths: string[] = [];

    const { simpleGit: makeGit } = await import('simple-git');
    const git = makeGit(worktreePath);

    for (const fileName of cacheFiles) {
      if (!fileName.endsWith('.md')) continue;

      const target = join(this.cacheDir, fileName);
      const linkPath = join(destDir, fileName);

      // If a non-symlink (regular file) already exists at the destination
      // the target repo may own it — leave it alone.
      let existingIsSymlink = false;
      try {
        const st = await lstat(linkPath);
        if (st.isSymbolicLink()) {
          existingIsSymlink = true;
        } else {
          continue;
        }
      } catch {
        // Doesn't exist yet — good, we'll create it.
      }

      if (existingIsSymlink) {
        await unlink(linkPath);
      }

      await symlink(target, linkPath);

      const destRelPath = relative(worktreePath, linkPath);
      const lsOutput = await git.raw(['ls-files', destRelPath]);
      if (lsOutput.trim() === '') {
        syncedRelPaths.push(destRelPath);
      }
    }

    if (syncedRelPaths.length > 0) {
      this.logger.debug(
        `Symlinked ${syncedRelPaths.length} agent file(s) from cache → ${destDir}`,
        { issueNumber },
      );
    }
    return syncedRelPaths;
  }
}
