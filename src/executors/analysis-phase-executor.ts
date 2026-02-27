import { join } from 'node:path';
import { writeFile } from 'node:fs/promises';
import type { PhaseExecutor, PhaseContext } from '../core/phase-executor.js';
import { launchWithRetry } from './helpers.js';
import { atomicWriteJSON, ensureDir, listFilesRecursive } from '../util/fs.js';
import { captureBaseline as captureBaselineCmd } from '@cadre/command-diagnostics';
import type { BaselineResults } from '@cadre/command-diagnostics';

export class AnalysisPhaseExecutor implements PhaseExecutor {
  readonly phaseId = 1;
  readonly name = 'Analysis & Scouting';

  async execute(ctx: PhaseContext): Promise<string> {
    await ensureDir(ctx.io.progressDir);

    // Write issue JSON
    const issueJsonPath = join(ctx.io.progressDir, 'issue.json');
    await atomicWriteJSON(issueJsonPath, ctx.issue);

    // Generate file tree
    const fileTreePath = join(ctx.io.progressDir, 'repo-file-tree.txt');
    const files = await listFilesRecursive(ctx.worktree.path);
    const fileTree = files.filter((f) => !f.startsWith('.cadre/')).join('\n');
    await writeFile(fileTreePath, fileTree, 'utf-8');

    // Build context for issue-analyst
    const analystContextPath = await ctx.services.contextBuilder.build('issue-analyst', {
      issueNumber: ctx.issue.number,
      worktreePath: ctx.worktree.path,
      issueJsonPath,
      progressDir: ctx.io.progressDir,
    });

    // Launch issue-analyst
    const analystResult = await launchWithRetry(ctx, 'issue-analyst', {
      agent: 'issue-analyst',
      issueNumber: ctx.issue.number,
      phase: 1,
      contextPath: analystContextPath,
      outputPath: join(ctx.io.progressDir, 'analysis.md'),
    });

    if (!analystResult.success) {
      throw new Error(`Issue analyst failed: ${analystResult.error}`);
    }

    // Build context for codebase-scout (needs analysis.md)
    const scoutContextPath = await ctx.services.contextBuilder.build('codebase-scout', {
      issueNumber: ctx.issue.number,
      worktreePath: ctx.worktree.path,
      analysisPath: join(ctx.io.progressDir, 'analysis.md'),
      fileTreePath,
      progressDir: ctx.io.progressDir,
    });

    // Launch codebase-scout
    const scoutResult = await launchWithRetry(ctx, 'codebase-scout', {
      agent: 'codebase-scout',
      issueNumber: ctx.issue.number,
      phase: 1,
      contextPath: scoutContextPath,
      outputPath: join(ctx.io.progressDir, 'scout-report.md'),
    });

    if (!scoutResult.success) {
      throw new Error(`Codebase scout failed: ${scoutResult.error}`);
    }

    // Capture baseline build/test results
    await this.captureBaseline(ctx);

    return join(ctx.io.progressDir, 'scout-report.md');
  }

  private async captureBaseline(ctx: PhaseContext): Promise<void> {
    const baselinePath = join(ctx.worktree.path, '.cadre', 'baseline-results.json');

    let baseline: BaselineResults;
    try {
      baseline = await captureBaselineCmd({
        cwd: ctx.worktree.path,
        buildCommand: ctx.config.commands.build,
        testCommand: ctx.config.commands.test,
        timeout: 300_000,
      });
    } catch (err) {
      ctx.services.logger.warn(`Baseline capture encountered an error: ${String(err)}`);
      baseline = { buildExitCode: 0, testExitCode: 0, buildFailures: [], testFailures: [] };
    }

    await atomicWriteJSON(baselinePath, baseline);
  }
}
