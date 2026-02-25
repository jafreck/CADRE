import { join } from 'node:path';
import { writeFile } from 'node:fs/promises';
import type { PhaseExecutor, PhaseContext } from '../core/phase-executor.js';
import { launchWithRetry } from './helpers.js';
import { isCadreSelfRun } from '../util/cadre-self-run.js';
import type { PRContent } from '../agents/types.js';

/** Maximum number of extra re-invocations when pr-content.md fails to parse. */
const MAX_PARSE_RETRIES = 1;

export class PRCompositionPhaseExecutor implements PhaseExecutor {
  readonly phaseId = 5;
  readonly name = 'PR Composition';

  async execute(ctx: PhaseContext): Promise<string> {
    const analysisPath = join(ctx.io.progressDir, 'analysis.md');
    const planPath = join(ctx.io.progressDir, 'implementation-plan.md');
    const integrationReportPath = join(ctx.io.progressDir, 'integration-report.md');

    // Generate diff
    const diffPath = join(ctx.io.progressDir, 'full-diff.patch');
    const diff = await ctx.io.commitManager.getDiff(ctx.worktree.baseCommit);
    await writeFile(diffPath, diff, 'utf-8');

    // Launch pr-composer
    const composerContextPath = await ctx.services.contextBuilder.buildForPRComposer(
      ctx.issue.number,
      ctx.worktree.path,
      ctx.issue,
      analysisPath,
      planPath,
      integrationReportPath,
      diffPath,
      ctx.io.progressDir,
    );

    const prContentPath = join(ctx.io.progressDir, 'pr-content.md');

    const composerResult = await launchWithRetry(ctx, 'pr-composer', {
      agent: 'pr-composer',
      issueNumber: ctx.issue.number,
      phase: 5,
      contextPath: composerContextPath,
      outputPath: prContentPath,
    });

    if (!composerResult.success) {
      throw new Error(`PR composer failed: ${composerResult.error}`);
    }

    if (!composerResult.outputExists) {
      throw new Error('pr-composer exited successfully but did not write pr-content.md');
    }

    // Create PR if auto-create is enabled
    if (ctx.config.pullRequest.autoCreate) {
      // Validate that pr-content.md contains a parseable cadre-json block.
      // Re-invoke the agent with parse-failure feedback if validation fails.
      let lastParseError: Error | null = null;
      let prContent: PRContent | undefined;

      for (let attempt = 0; attempt <= MAX_PARSE_RETRIES; attempt++) {
        if (attempt > 0) {
          // Re-build context and re-invoke the agent so it can self-correct.
          const retryContextPath = await ctx.services.contextBuilder.buildForPRComposer(
            ctx.issue.number,
            ctx.worktree.path,
            ctx.issue,
            analysisPath,
            planPath,
            integrationReportPath,
            diffPath,
            ctx.io.progressDir,
          );
          const retryResult = await launchWithRetry(ctx, 'pr-composer', {
            agent: 'pr-composer',
            issueNumber: ctx.issue.number,
            phase: 5,
            contextPath: retryContextPath,
            outputPath: prContentPath,
          });
          if (!retryResult.success) {
            throw new Error(`PR composer failed on parse-retry: ${retryResult.error}`);
          }
          if (!retryResult.outputExists) {
            throw new Error('pr-composer did not write pr-content.md on parse-retry');
          }
        }

        try {
          prContent = await ctx.services.resultParser.parsePRContent(prContentPath);
          lastParseError = null;
          break;
        } catch (err) {
          lastParseError = err as Error;
        }
      }

      if (lastParseError !== null) {
        throw new Error(
          `pr-composer output could not be parsed after ${MAX_PARSE_RETRIES + 1} attempt(s): ${lastParseError.message}`,
        );
      }

      // Strip cadre-internal artefacts from committed history.
      // Replays each agent commit, removing cadre files from the index, while
      // preserving the original commit message, author, and timestamps.
      await ctx.io.commitManager.stripCadreFiles(ctx.worktree.baseCommit);

      // Push
      await ctx.io.commitManager.push(true, ctx.worktree.branch);

      // Create PR
      const prTitle = `${prContent!.title || ctx.issue.title} (#${ctx.issue.number})`;
      let prBody = prContent!.body;

      // Add issue link if configured
      if (ctx.config.pullRequest.linkIssue) {
        prBody += `\n\n${ctx.platform.issueLinkSuffix(ctx.issue.number)}`;
      }

      let labels = ctx.config.pullRequest.labels ?? [];
      if (isCadreSelfRun(ctx.config)) {
        await ctx.platform.ensureLabel('cadre-generated');
        if (!labels.includes('cadre-generated')) {
          labels = [...labels, 'cadre-generated'];
        }
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
    }

    return prContentPath;
  }
}
