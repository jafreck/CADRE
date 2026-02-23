import { join } from 'node:path';
import { writeFile } from 'node:fs/promises';
import type { PhaseExecutor, PhaseContext } from '../core/phase-executor.js';
import type { AgentInvocation, AgentResult } from '../agents/types.js';
import { atomicWriteJSON, ensureDir, listFilesRecursive } from '../util/fs.js';
import { execShell } from '../util/process.js';

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

    // Capture baseline build/test results
    await this.captureBaseline(ctx);

    return join(ctx.progressDir, 'scout-report.md');
  }

  private async captureBaseline(ctx: PhaseContext): Promise<void> {
    const baselinePath = join(ctx.worktree.path, '.cadre', 'baseline-results.json');

    let buildExitCode = 0;
    let testExitCode = 0;
    let buildFailures: string[] = [];
    let testFailures: string[] = [];

    try {
      if (ctx.config.commands.build) {
        const result = await execShell(ctx.config.commands.build, {
          cwd: ctx.worktree.path,
          timeout: 300_000,
        });
        buildExitCode = result.exitCode ?? 1;
        if (buildExitCode !== 0) {
          buildFailures = this.extractFailures(result.stdout + '\n' + result.stderr);
        }
      }

      if (ctx.config.commands.test) {
        const result = await execShell(ctx.config.commands.test, {
          cwd: ctx.worktree.path,
          timeout: 300_000,
        });
        testExitCode = result.exitCode ?? 1;
        if (testExitCode !== 0) {
          testFailures = this.extractFailures(result.stdout + '\n' + result.stderr);
        }
      }
    } catch (err) {
      ctx.logger.warn(`Baseline capture encountered an error: ${String(err)}`);
    }

    await atomicWriteJSON(baselinePath, {
      buildExitCode,
      testExitCode,
      buildFailures,
      testFailures,
    });
  }

  /**
   * Extract failing test/build identifiers from command output using line-based heuristics.
   */
  private extractFailures(output: string): string[] {
    const failures = new Set<string>();
    for (const line of output.split('\n')) {
      const trimmed = line.trim();
      // Common failure patterns: lines containing FAIL, ✗, ×, error:, Error:
      if (/^(FAIL|FAILED|✗|×)\s+/.test(trimmed)) {
        const match = trimmed.match(/^(?:FAIL|FAILED|✗|×)\s+(.+)/);
        if (match) failures.add(match[1].trim());
      } else if (/^\s*(error|Error)\s*:/i.test(trimmed) && trimmed.length < 200) {
        failures.add(trimmed);
      }
    }
    return Array.from(failures);
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
