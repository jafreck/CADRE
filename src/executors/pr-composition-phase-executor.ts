import { join } from 'node:path';
import { writeFile } from 'node:fs/promises';
import { simpleGit } from 'simple-git';
import type { PhaseExecutor, PhaseContext } from '../core/phase-executor.js';
import { launchWithRetry } from './helpers.js';
import { isCadreSelfRun } from '../util/cadre-self-run.js';
import type { AgentResult, PRContent } from '../agents/types.js';
import { extractCadreJson } from '@cadre-dev/framework/runtime';
import type { PullRequestMergeMethod } from '../platform/provider.js';
import { formatPullRequestTitle } from '../util/title-format.js';

/** Maximum total invocations (initial + retries) when pr-content.md fails to parse. */
const MAX_ATTEMPTS = 2;
const MAX_MERGE_RESOLUTION_ATTEMPTS = 3;

/** Base delay (ms) after pushing conflict resolution before retrying merge. Increases exponentially per attempt. */
const BASE_POST_RESOLVE_DELAY_MS = 15_000;

/** Cadre artifact path patterns used to detect cadre-only conflicts. */
const CADRE_ARTIFACT_PATTERNS = ['.cadre/', 'task-', '.github/agents/', '.claude/agents/'];

type MergeBlockReason = 'dirty' | 'checks-failed' | 'blocked';

export class PRCompositionPhaseExecutor implements PhaseExecutor {
  readonly phaseId = 5;
  readonly name = 'PR Composition';

  async execute(ctx: PhaseContext): Promise<string> {
    const analysisPath = join(ctx.io.progressDir, 'analysis.md');
    const planPath = join(ctx.io.progressDir, 'implementation-plan.md');
    const integrationReportPath = join(ctx.io.progressDir, 'integration-report.md');
    const prContentPath = join(ctx.io.progressDir, 'pr-content.md');

    // Generate diff
    const diffPath = join(ctx.io.progressDir, 'full-diff.patch');
    const diff = await ctx.io.commitManager.getDiff(ctx.worktree.baseCommit);
    await writeFile(diffPath, diff, 'utf-8');

    // Initial pr-composer invocation
    await this.invokeComposer(ctx, analysisPath, planPath, integrationReportPath, diffPath, prContentPath);

    if (ctx.config.pullRequest.autoCreate) {
      const prContent = await this.parseWithRetry(
        ctx, analysisPath, planPath, integrationReportPath, diffPath, prContentPath,
      );
      await this.createPullRequest(ctx, prContent);
    }

    return prContentPath;
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Invoke the pr-composer agent.  When `parseError` is supplied the context
   * includes the error so the agent can self-correct.
   */
  private async invokeComposer(
    ctx: PhaseContext,
    analysisPath: string,
    planPath: string,
    integrationReportPath: string,
    diffPath: string,
    prContentPath: string,
    parseError?: string,
  ): Promise<void> {
    const contextPath = await ctx.services.contextBuilder.build('pr-composer', {
      issueNumber: ctx.issue.number,
      worktreePath: ctx.worktree.path,
      issue: ctx.issue,
      analysisPath,
      planPath,
      integrationReportPath,
      diffPath,
      progressDir: ctx.io.progressDir,
      ...(parseError !== undefined ? { previousParseError: parseError } : {}),
    });

    const result = await launchWithRetry(ctx, 'pr-composer', {
      agent: 'pr-composer',
      issueNumber: ctx.issue.number,
      phase: 5,
      contextPath,
      outputPath: prContentPath,
    });

    if (!result.success) {
      const label = parseError ? 'on parse-retry' : '';
      throw new Error(`PR composer failed${label ? ` ${label}` : ''}: ${result.error}`);
    }

    await this.ensureOutputFile(result, prContentPath);
  }

  /**
   * When the agent wrote to stdout instead of the output path, extract the
   * cadre-json block and persist it so downstream logic can read it normally.
   */
  private async ensureOutputFile(result: AgentResult, outputPath: string): Promise<void> {
    if (result.outputExists) return;

    const extracted = extractCadreJson(result.stdout);
    if (extracted === null) {
      throw new Error('pr-composer exited successfully but did not write pr-content.md');
    }
    const content = `\`\`\`cadre-json\n${JSON.stringify(extracted, null, 2)}\n\`\`\`\n`;
    await writeFile(outputPath, content, 'utf-8');
  }

  /**
   * Parse pr-content.md, re-invoking the composer with parse-error feedback
   * if the first attempt fails.
   */
  private async parseWithRetry(
    ctx: PhaseContext,
    analysisPath: string,
    planPath: string,
    integrationReportPath: string,
    diffPath: string,
    prContentPath: string,
  ): Promise<PRContent> {
    let lastError: Error | undefined;

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      if (attempt > 0) {
        await this.invokeComposer(
          ctx, analysisPath, planPath, integrationReportPath, diffPath, prContentPath,
          lastError!.message,
        );
      }

      try {
        return await ctx.services.resultParser.parsePRContent(prContentPath);
      } catch (err) {
        lastError = err as Error;
      }
    }

    throw new Error(
      `pr-composer output could not be parsed after ${MAX_ATTEMPTS} attempt(s): ${lastError!.message}`,
    );
  }

  /** Rebase onto base branch before push, then push and open the pull request. */
  private async createPullRequest(ctx: PhaseContext, prContent: PRContent): Promise<void> {
    // Fix 1: Rebase onto latest base branch before pushing to eliminate trivial behind-base dirtiness.
    await this.rebaseOntoBase(ctx);

    // Defence-in-depth: ensure no cadre artifacts leaked into the diff
    // (e.g. from rebase carrying forward artifacts already on the base branch,
    // or from an agent independently committing .cadre/ files).
    await ctx.io.commitManager.ensureNoCadreArtifactsInDiff(ctx.worktree.baseCommit);

    await ctx.io.commitManager.push(true, ctx.worktree.branch);

    const prTitle = formatPullRequestTitle(prContent.title, ctx.issue.title, ctx.issue.number);
    let prBody = prContent.body;
    if (ctx.config.pullRequest.linkIssue) {
      prBody += `\n\n${ctx.platform.issueLinkSuffix(ctx.issue.number)}`;
    }

    const labels = await this.resolveLabels(ctx);

    const existingPR = await ctx.platform.findOpenPR(ctx.issue.number, ctx.worktree.branch);
    if (existingPR !== null) {
      await ctx.platform.updatePullRequest(existingPR.number, { title: prTitle, body: prBody });
      ctx.callbacks.setPR?.(existingPR);
      // Fix 2: Do not merge inline — the fleet orchestrator's completion queue handles serial merge.
      return;
    }

    const pr = await ctx.platform.createPullRequest({
      title: prTitle,
      body: prBody,
      head: ctx.worktree.branch,
      base: ctx.config.baseBranch,
      draft: ctx.config.pullRequest.draft,
      labels,
      reviewers: ctx.config.pullRequest.reviewers,
    }).catch((err: Error) => {
      // "No commits between base and head" means the branch content was
      // already merged into the base (e.g. via squash-merge of earlier PRs
      // that included the same dependency commits).  Check for a merged PR.
      if (err.message?.includes('No commits between')) {
        ctx.services.logger.warn(
          `PR creation failed (no unique commits) for issue #${ctx.issue.number}; checking for already-merged PR`,
          { issueNumber: ctx.issue.number },
        );
        return null;
      }
      throw err;
    });

    if (pr === null) {
      // Branch has no unique commits — look for a merged PR that covers it.
      const allPRs = await ctx.platform.listPullRequests({ head: ctx.worktree.branch, state: 'all' });
      const mergedPR = allPRs.find((p) => p.state === 'merged');
      if (mergedPR) {
        ctx.services.logger.info(
          `Issue #${ctx.issue.number} branch already merged via PR #${mergedPR.number}`,
          { issueNumber: ctx.issue.number },
        );
        ctx.callbacks.setPR?.(mergedPR);
        return;
      }
      // No merged PR found — the branch genuinely has no changes.
      throw new Error(
        `No commits between ${ctx.config.baseBranch} and ${ctx.worktree.branch} and no merged PR found`,
      );
    }

    ctx.callbacks.setPR?.(pr);
    // Fix 2: Do not merge inline — the fleet orchestrator's completion queue handles serial merge.
  }

  /**
   * Fetch the latest base branch and rebase the worktree onto it.
   * If the rebase fails (real conflicts), abort gracefully — the PR
   * will still be created and the completion queue can resolve later.
   */
  private async rebaseOntoBase(ctx: PhaseContext): Promise<void> {
    const git = simpleGit(ctx.worktree.path);
    try {
      await git.fetch('origin', ctx.config.baseBranch);
      await git.rebase([`origin/${ctx.config.baseBranch}`]);
      ctx.services.logger.info(
        `Rebased onto origin/${ctx.config.baseBranch} before push`,
        { issueNumber: ctx.issue.number },
      );
    } catch (err) {
      // Abort the failed rebase so the worktree is back to a clean state.
      await git.rebase(['--abort']).catch(() => {});
      ctx.services.logger.warn(
        `Rebase onto origin/${ctx.config.baseBranch} failed; pushing as-is: ${String(err)}`,
        { issueNumber: ctx.issue.number },
      );
    }
  }

  private async getConflictedFiles(git: ReturnType<typeof simpleGit>): Promise<string[]> {
    try {
      const output = await git.raw(['diff', '--name-only', '--diff-filter=U']);
      return output
        .trim()
        .split('\n')
        .map((file) => file.trim())
        .filter((file) => file.length > 0);
    } catch {
      return [];
    }
  }

  /** Compute final label set, adding 'cadre-generated' for self-runs. */
  private async resolveLabels(ctx: PhaseContext): Promise<string[]> {
    const labels = ctx.config.pullRequest.labels ?? [];
    if (!isCadreSelfRun(ctx.config)) return labels;

    await ctx.platform.ensureLabel('cadre-generated');
    return labels.includes('cadre-generated') ? labels : [...labels, 'cadre-generated'];
  }
}
