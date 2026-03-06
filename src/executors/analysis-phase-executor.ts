import { join } from 'node:path';
import { writeFile } from 'node:fs/promises';
import type { PhaseExecutor, PhaseContext } from '../core/phase-executor.js';
import { launchWithRetry } from './helpers.js';
import { atomicWriteJSON, ensureDir, listFilesRecursive } from '../util/fs.js';
import { captureBaseline as captureBaselineCmd } from '@cadre-dev/framework/runtime';
import { extractCadreJson, type BaselineResults } from '@cadre-dev/framework/runtime';
import type { AgentResult } from '../agents/types.js';

export class AnalysisPhaseExecutor implements PhaseExecutor {
  readonly id = 1;
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

    await this.ensureOutputFile(analystResult, join(ctx.io.progressDir, 'analysis.md'));

    const analysisPath = join(ctx.io.progressDir, 'analysis.md');
    const analysis = await ctx.services.resultParser.parseAnalysis(analysisPath);
    const scoutPolicy = analysis.scoutPolicy;
    const shouldRunScout = scoutPolicy !== 'skip';
    const scoutRequired = scoutPolicy === 'required';

    if (shouldRunScout) {
      // Build context for codebase-scout (needs analysis.md)
      const scoutContextPath = await ctx.services.contextBuilder.build('codebase-scout', {
        issueNumber: ctx.issue.number,
        worktreePath: ctx.worktree.path,
        analysisPath,
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
        if (scoutRequired) {
          throw new Error(`Codebase scout failed: ${scoutResult.error}`);
        }
        ctx.services.logger.warn(
          `Codebase scout failed but scoutPolicy is ${scoutPolicy}; continuing without scout report: ${scoutResult.error}`,
          { issueNumber: ctx.issue.number, phase: 1 },
        );
      }
    } else {
      ctx.services.logger.info(
        `Skipping codebase-scout due to issue-analyst scoutPolicy=${scoutPolicy}`,
        { issueNumber: ctx.issue.number, phase: 1 },
      );
    }

    // Capture baseline build/test results (unless opted out)
    if (!ctx.config.options.skipBaseline) {
      await this.captureBaseline(ctx);
    }

    return shouldRunScout ? join(ctx.io.progressDir, 'scout-report.md') : analysisPath;
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

  private async ensureOutputFile(result: AgentResult, outputPath: string): Promise<void> {
    if (result.outputExists) return;

    const stdout = result.stdout.trim();
    if (stdout.length === 0) {
      throw new Error('issue-analyst exited successfully but did not write analysis.md');
    }

    const extracted = extractCadreJson(stdout);
    if (extracted === null) {
      throw new Error('issue-analyst exited successfully but stdout did not contain a cadre-json block');
    }

    await writeFile(outputPath, `${stdout}\n`, 'utf-8');
  }
}
