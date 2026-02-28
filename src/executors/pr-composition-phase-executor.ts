import { join } from 'node:path';
import { writeFile } from 'node:fs/promises';
import type { PhaseExecutor, PhaseContext } from '../core/phase-executor.js';
import { launchWithRetry } from './helpers.js';
import { isCadreSelfRun } from '../util/cadre-self-run.js';
import type { AgentResult, PRContent } from '../agents/types.js';
import { extractCadreJson } from '../util/cadre-json.js';
import type { PullRequestMergeMethod } from '../platform/provider.js';
import { formatPullRequestTitle } from '../util/title-format.js';

/** Maximum total invocations (initial + retries) when pr-content.md fails to parse. */
const MAX_ATTEMPTS = 2;

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

  /** Strip cadre artefacts, push, and open the pull request. */
  private async createPullRequest(ctx: PhaseContext, prContent: PRContent): Promise<void> {
    await ctx.io.commitManager.stripCadreFiles(ctx.worktree.baseCommit);
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

    try {
      await ctx.platform.mergePullRequest(prNumber, ctx.config.baseBranch, mergeMethod);
      ctx.services.logger.info(
        `Auto-completed PR #${prNumber} into ${ctx.config.baseBranch} using ${mergeMethod} merge`,
        { issueNumber: ctx.issue.number },
      );
    } catch (err) {
      ctx.services.logger.warn(
        `Auto-complete failed for PR #${prNumber}: ${String(err)}`,
        { issueNumber: ctx.issue.number },
      );
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
