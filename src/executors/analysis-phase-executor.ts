import { join } from 'node:path';
import { writeFile } from 'node:fs/promises';
import type { PhaseExecutor, PhaseContext } from '../core/phase-executor.js';
import type { AgentInvocation, AgentResult } from '../agents/types.js';
import { atomicWriteJSON, ensureDir, listFilesRecursive } from '../util/fs.js';

export class AnalysisPhaseExecutor implements PhaseExecutor {
  readonly phaseId = 1;
  readonly name = 'Analysis & Scouting';

  async execute(ctx: PhaseContext): Promise<string> {
    await ensureDir(ctx.progressDir);

    // Write issue JSON
    const issueJsonPath = join(ctx.progressDir, 'issue.json');
    await atomicWriteJSON(issueJsonPath, ctx.issue);

    // Generate file tree
    const fileTreePath = join(ctx.progressDir, 'repo-file-tree.txt');
    const files = await listFilesRecursive(ctx.worktree.path);
    const fileTree = files.filter((f) => !f.startsWith('.cadre/')).join('\n');
    await writeFile(fileTreePath, fileTree, 'utf-8');

    // Build context for issue-analyst
    const analystContextPath = await ctx.contextBuilder.buildForIssueAnalyst(
      ctx.issue.number,
      ctx.worktree.path,
      issueJsonPath,
      ctx.progressDir,
    );

    // Launch issue-analyst
    const analystResult = await this.launchWithRetry(ctx, 'issue-analyst', {
      agent: 'issue-analyst',
      issueNumber: ctx.issue.number,
      phase: 1,
      contextPath: analystContextPath,
      outputPath: join(ctx.progressDir, 'analysis.md'),
    });

    if (!analystResult.success) {
      throw new Error(`Issue analyst failed: ${analystResult.error}`);
    }

    // Build context for codebase-scout (needs analysis.md)
    const scoutContextPath = await ctx.contextBuilder.buildForCodebaseScout(
      ctx.issue.number,
      ctx.worktree.path,
      join(ctx.progressDir, 'analysis.md'),
      fileTreePath,
      ctx.progressDir,
    );

    // Launch codebase-scout
    const scoutResult = await this.launchWithRetry(ctx, 'codebase-scout', {
      agent: 'codebase-scout',
      issueNumber: ctx.issue.number,
      phase: 1,
      contextPath: scoutContextPath,
      outputPath: join(ctx.progressDir, 'scout-report.md'),
    });

    if (!scoutResult.success) {
      throw new Error(`Codebase scout failed: ${scoutResult.error}`);
    }

    return join(ctx.progressDir, 'scout-report.md');
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
