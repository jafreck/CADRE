import { join } from 'node:path';
import { writeFile } from 'node:fs/promises';
import type { PhaseExecutor, PhaseContext } from '../core/phase-executor.js';
import { launchWithRetry } from './helpers.js';

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

    const composerResult = await launchWithRetry(ctx, 'pr-composer', {
      agent: 'pr-composer',
      issueNumber: ctx.issue.number,
      phase: 5,
      contextPath: composerContextPath,
      outputPath: join(ctx.io.progressDir, 'pr-content.md'),
    });

    if (!composerResult.success) {
      throw new Error(`PR composer failed: ${composerResult.error}`);
    }

    if (!composerResult.outputExists) {
      throw new Error('pr-composer exited successfully but did not write pr-content.md');
    }

    // Create PR if auto-create is enabled
    if (ctx.config.pullRequest.autoCreate) {
      const prContentPath = join(ctx.io.progressDir, 'pr-content.md');
      const prContent = await ctx.services.resultParser.parsePRContent(prContentPath);

      // Strip cadre-internal artefacts from committed history.
      // Replays each agent commit, removing cadre files from the index, while
      // preserving the original commit message, author, and timestamps.
      await ctx.io.commitManager.stripCadreFiles(ctx.worktree.baseCommit);

      // Push
      await ctx.io.commitManager.push(true, ctx.worktree.branch);

      // Create PR
      try {
        const prTitle = `${prContent.title || ctx.issue.title} (#${ctx.issue.number})`;
        let prBody = prContent.body;

        // Add issue link if configured
        if (ctx.config.pullRequest.linkIssue) {
          prBody += `\n\n${ctx.platform.issueLinkSuffix(ctx.issue.number)}`;
        }

        const pr = await ctx.platform.createPullRequest({
          title: prTitle,
          body: prBody,
          head: ctx.worktree.branch,
          base: ctx.config.baseBranch,
          draft: ctx.config.pullRequest.draft,
          labels: ctx.config.pullRequest.labels,
          reviewers: ctx.config.pullRequest.reviewers,
        });
        ctx.callbacks.onPRCreated?.(pr);
      } catch (err) {
        // Non-critical: the branch is pushed, PR can be created manually
        ctx.services.logger.error(`Failed to create PR: ${err}`, {
          issueNumber: ctx.issue.number,
        });
        ctx.callbacks.onPRFailed?.();
      }
    }

    return join(ctx.io.progressDir, 'pr-content.md');
  }
}
