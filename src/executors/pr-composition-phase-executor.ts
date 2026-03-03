import { join } from 'node:path';
import { writeFile } from 'node:fs/promises';
import { simpleGit } from 'simple-git';
import type { PhaseExecutor, PhaseContext } from '../core/phase-executor.js';
import { launchWithRetry } from './helpers.js';
import { isCadreSelfRun } from '../util/cadre-self-run.js';
import type { AgentResult, PRContent } from '../agents/types.js';
import { extractCadreJson } from '@cadre/framework/runtime';
import type { PullRequestMergeMethod } from '../platform/provider.js';
import { formatPullRequestTitle } from '../util/title-format.js';

/** Maximum total invocations (initial + retries) when pr-content.md fails to parse. */
const MAX_ATTEMPTS = 2;
const MAX_MERGE_RESOLUTION_ATTEMPTS = 2;

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

  /** Push and open the pull request. */
  private async createPullRequest(ctx: PhaseContext, prContent: PRContent): Promise<void> {
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
      await this.autoCompleteIfEnabled(ctx, existingPR.number);
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
    });
    ctx.callbacks.setPR?.(pr);
    if (pr?.number != null) {
      await this.autoCompleteIfEnabled(ctx, pr.number);
    }
  }

  private async autoCompleteIfEnabled(ctx: PhaseContext, prNumber: number): Promise<void> {
    const autoComplete = ctx.config.pullRequest.autoComplete;
    if (autoComplete == null) return;

    const isEnabled =
      typeof autoComplete === 'boolean'
        ? autoComplete
        : (autoComplete.enabled ?? false);
    if (!isEnabled) return;

    const mergeMethod: PullRequestMergeMethod =
      typeof autoComplete === 'boolean'
        ? 'squash'
        : (autoComplete.merge_method ?? 'squash');

    for (let attempt = 1; attempt <= MAX_MERGE_RESOLUTION_ATTEMPTS; attempt++) {
      try {
        await ctx.platform.mergePullRequest(prNumber, ctx.config.baseBranch, mergeMethod);
        ctx.services.logger.info(
          `Auto-completed PR #${prNumber} into ${ctx.config.baseBranch} using ${mergeMethod} merge`,
          { issueNumber: ctx.issue.number },
        );
        return;
      } catch (err) {
        const reason = this.detectMergeBlockReason(err);
        if (reason == null || attempt >= MAX_MERGE_RESOLUTION_ATTEMPTS) {
          ctx.services.logger.warn(
            `Auto-complete failed for PR #${prNumber}: ${String(err)}`,
            { issueNumber: ctx.issue.number },
          );
          return;
        }

        ctx.services.logger.info(
          `PR #${prNumber} merge blocked (${reason}); launching auto-resolution (attempt ${attempt}/${MAX_MERGE_RESOLUTION_ATTEMPTS})`,
          { issueNumber: ctx.issue.number },
        );
        await this.autoResolveMergeBlock(ctx, prNumber, reason, String(err));
      }
    }
  }

  private detectMergeBlockReason(err: unknown): MergeBlockReason | null {
    const message = String(err).toLowerCase();
    if (
      message.includes('mergeable_state=dirty')
      || message.includes('has merge conflicts')
      || message.includes('merge conflicts')
    ) {
      return 'dirty';
    }
    if (message.includes('checks failed')) {
      return 'checks-failed';
    }
    if (message.includes('mergeable_state=blocked') || message.includes('blocked')) {
      return 'blocked';
    }
    return null;
  }

  private async autoResolveMergeBlock(
    ctx: PhaseContext,
    prNumber: number,
    reason: MergeBlockReason,
    details: string,
  ): Promise<void> {
    if (reason === 'dirty') {
      await this.resolveMergeConflicts(ctx, prNumber, details);
      return;
    }

    await this.resolveCheckOrPolicyBlock(ctx, reason, details);
  }

  private async resolveMergeConflicts(ctx: PhaseContext, prNumber: number, details: string): Promise<void> {
    const git = simpleGit(ctx.worktree.path);
    await git.fetch('origin', ctx.config.baseBranch);

    try {
      await git.merge([`origin/${ctx.config.baseBranch}`, '--no-edit']);
    } catch {
      const conflictedFiles = await this.getConflictedFiles(git);
      if (conflictedFiles.length === 0) {
        throw new Error(`PR #${prNumber} reported dirty merge state, but no conflicted files were detected`);
      }

      const conflictDetailsPath = join(ctx.io.progressDir, 'merge-conflict-details.txt');
      await writeFile(conflictDetailsPath, details, 'utf-8');

      const contextPath = await ctx.services.contextBuilder.build('conflict-resolver', {
        issueNumber: ctx.issue.number,
        worktreePath: ctx.worktree.path,
        conflictedFiles,
        progressDir: ctx.io.progressDir,
      });

      const resolverResult = await launchWithRetry(ctx, 'conflict-resolver', {
        agent: 'conflict-resolver',
        issueNumber: ctx.issue.number,
        phase: 5,
        contextPath,
        outputPath: join(ctx.io.progressDir, 'merge-conflict-resolution-report.md'),
      });

      if (!resolverResult.success) {
        throw new Error(`conflict-resolver failed while resolving PR #${prNumber} merge conflicts`);
      }

      if (!resolverResult.outputExists) {
        throw new Error('conflict-resolver completed without producing merge conflict report output');
      }

      await git.add(['-A']);
      await git.raw(['commit', '--no-edit']);
    }

    await ctx.io.commitManager.push(true, ctx.worktree.branch);
  }

  private async resolveCheckOrPolicyBlock(
    ctx: PhaseContext,
    reason: MergeBlockReason,
    details: string,
  ): Promise<void> {
    const feedbackPath = join(ctx.io.progressDir, 'merge-blocker-feedback.txt');
    await writeFile(
      feedbackPath,
      `PR merge blocked: ${reason}\n\n${details}\n`,
      'utf-8',
    );

    const changedFiles = await ctx.io.commitManager.getChangedFiles();
    const contextPath = await ctx.services.contextBuilder.build('fix-surgeon', {
      issueNumber: ctx.issue.number,
      worktreePath: ctx.worktree.path,
      sessionId: `merge-block-${reason}`,
      feedbackPath,
      changedFiles: changedFiles.map((f) => join(ctx.worktree.path, f)),
      progressDir: ctx.io.progressDir,
      issueType: 'test-failure',
      phase: 5,
    });

    const fixResult = await launchWithRetry(ctx, 'fix-surgeon', {
      agent: 'fix-surgeon',
      issueNumber: ctx.issue.number,
      phase: 5,
      contextPath,
      outputPath: ctx.worktree.path,
    });

    if (!fixResult.success) {
      throw new Error(`fix-surgeon failed while resolving merge blocker (${reason})`);
    }

    if (!(await ctx.io.commitManager.isClean())) {
      await ctx.io.commitManager.commit('address merge blocker', ctx.issue.number, 'fix');
      await ctx.io.commitManager.push(true, ctx.worktree.branch);
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
