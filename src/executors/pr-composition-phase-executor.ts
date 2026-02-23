import { join } from 'node:path';
import { writeFile } from 'node:fs/promises';
import type { PhaseExecutor, PhaseContext } from '../core/phase-executor.js';
import type { AgentInvocation, AgentResult } from '../agents/types.js';

export class PRCompositionPhaseExecutor implements PhaseExecutor {
  readonly phaseId = 5;
  readonly name = 'PR Composition';

  async execute(ctx: PhaseContext): Promise<string> {
    const analysisPath = join(ctx.progressDir, 'analysis.md');
    const planPath = join(ctx.progressDir, 'implementation-plan.md');
    const integrationReportPath = join(ctx.progressDir, 'integration-report.md');

    // Generate diff
    const diffPath = join(ctx.progressDir, 'full-diff.patch');
    const diff = await ctx.commitManager.getDiff(ctx.worktree.baseCommit);
    await writeFile(diffPath, diff, 'utf-8');

    // Launch pr-composer
    const composerContextPath = await ctx.contextBuilder.buildForPRComposer(
      ctx.issue.number,
      ctx.worktree.path,
      ctx.issue,
      analysisPath,
      planPath,
      integrationReportPath,
      diffPath,
      ctx.progressDir,
    );

    const composerResult = await this.launchWithRetry(ctx, 'pr-composer', {
      agent: 'pr-composer',
      issueNumber: ctx.issue.number,
      phase: 5,
      contextPath: composerContextPath,
      outputPath: join(ctx.progressDir, 'pr-content.md'),
    });

    if (!composerResult.success) {
      throw new Error(`PR composer failed: ${composerResult.error}`);
    }

    // Create PR if auto-create is enabled
    if (ctx.config.pullRequest.autoCreate) {
      const prContentPath = join(ctx.progressDir, 'pr-content.md');
      const prContent = await ctx.resultParser.parsePRContent(prContentPath);

      // Squash if configured
      if (ctx.config.commits.squashBeforePR) {
        await ctx.commitManager.squash(
          ctx.worktree.baseCommit,
          prContent.title || `Fix #${ctx.issue.number}: ${ctx.issue.title}`,
        );
      }

      // Push
      await ctx.commitManager.push(true);

      // Create PR
      try {
        const prTitle = `${prContent.title || ctx.issue.title} (#${ctx.issue.number})`;
        let prBody = prContent.body;

        // Add issue link if configured
        if (ctx.config.pullRequest.linkIssue) {
          prBody += `\n\n${ctx.platform.issueLinkSuffix(ctx.issue.number)}`;
        }

        await ctx.platform.createPullRequest({
          title: prTitle,
          body: prBody,
          head: ctx.worktree.branch,
          base: ctx.config.baseBranch,
          draft: ctx.config.pullRequest.draft,
        });
      } catch (err) {
        // Non-critical: the branch is pushed, PR can be created manually
        ctx.logger.error(`Failed to create PR: ${err}`, {
          issueNumber: ctx.issue.number,
        });
      }
    }

    return join(ctx.progressDir, 'pr-content.md');
  }

  private async launchWithRetry(
    ctx: PhaseContext,
    agentName: string,
    invocation: Omit<AgentInvocation, 'timeout'>,
  ): Promise<AgentResult> {
    const result = await ctx.retryExecutor.execute<AgentResult>({
      fn: async () => {
        ctx.checkBudget();
        const agentResult = await ctx.launcher.launchAgent(
          invocation as AgentInvocation,
          ctx.worktree.path,
        );
        ctx.recordTokens(agentName, agentResult.tokenUsage);
        ctx.checkBudget();
        if (!agentResult.success) {
          throw new Error(agentResult.error ?? `Agent ${agentName} failed`);
        }
        return agentResult;
      },
      maxAttempts: ctx.config.options.maxRetriesPerTask,
      description: agentName,
    });

    ctx.checkBudget();

    if (!result.success || !result.result) {
      return {
        agent: invocation.agent,
        success: false,
        exitCode: 1,
        timedOut: false,
        duration: 0,
        stdout: '',
        stderr: result.error ?? 'Unknown failure',
        tokenUsage: null,
        outputPath: invocation.outputPath,
        outputExists: false,
        error: result.error,
      };
    }

    return result.result;
  }
}
