import { join } from 'node:path';
import { writeFile } from 'node:fs/promises';
import type { PhaseExecutor, PhaseContext } from '../core/phase-executor.js';
import { launchWithRetry } from './helpers.js';
import { atomicWriteJSON, ensureDir, listFilesRecursive } from '../util/fs.js';
import { runWithRetry } from '../util/command-verifier.js';

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
    const analystContextPath = await ctx.services.contextBuilder.buildForIssueAnalyst(
      ctx.issue.number,
      ctx.worktree.path,
      issueJsonPath,
      ctx.io.progressDir,
    );

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
    const scoutContextPath = await ctx.services.contextBuilder.buildForCodebaseScout(
      ctx.issue.number,
      ctx.worktree.path,
      join(ctx.io.progressDir, 'analysis.md'),
      fileTreePath,
      ctx.io.progressDir,
    );

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

    let buildExitCode = 0;
    let testExitCode = 0;
    let buildFailures: string[] = [];
    let testFailures: string[] = [];

    try {
      if (ctx.config.commands.build) {
        const result = await runWithRetry({
          command: ctx.config.commands.build,
          cwd: ctx.worktree.path,
          timeout: 300_000,
          maxFixRounds: 0,
          onFixNeeded: async () => {},
        });
        buildExitCode = result.exitCode ?? 1;
        if (buildExitCode !== 0) {
          buildFailures = result.failures;
        }
      }

      if (ctx.config.commands.test) {
        const result = await runWithRetry({
          command: ctx.config.commands.test,
          cwd: ctx.worktree.path,
          timeout: 300_000,
          maxFixRounds: 0,
          onFixNeeded: async () => {},
        });
        testExitCode = result.exitCode ?? 1;
        if (testExitCode !== 0) {
          testFailures = result.failures;
        }
      }
    } catch (err) {
      ctx.services.logger.warn(`Baseline capture encountered an error: ${String(err)}`);
    }

    await atomicWriteJSON(baselinePath, {
      buildExitCode,
      testExitCode,
      buildFailures,
      testFailures,
    });
  }
}
