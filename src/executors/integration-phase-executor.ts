import { join } from 'node:path';
import { writeFile, readFile } from 'node:fs/promises';
import type { PhaseExecutor, PhaseContext } from '../core/phase-executor.js';
import { execShell } from '../util/process.js';
import { baselineResultsSchema } from '../agents/schemas/index.js';
import type { BaselineResults } from '../agents/schemas/index.js';
import { runWithRetry } from '../util/command-verifier.js';

export class IntegrationPhaseExecutor implements PhaseExecutor {
  readonly phaseId = 4;
  readonly name = 'Integration Verification';

  async execute(ctx: PhaseContext): Promise<string> {
    const reportPath = join(ctx.io.progressDir, 'integration-report.md');
    let report = '';

    // Structured results for the cadre-json block appended at the end
    let structuredBuildResult: { command: string; exitCode: number | null; signal: string | null; output: string; pass: boolean } | null = null;
    let structuredTestResult: { command: string; exitCode: number | null; signal: string | null; output: string; pass: boolean } | null = null;
    let structuredLintResult: { command: string; exitCode: number | null; signal: string | null; output: string; pass: boolean } | null = null;

    // Read baseline results (null-safe: missing baseline treats all failures as regressions)
    const baselineResultsPath = join(ctx.worktree.path, '.cadre', 'baseline-results.json');
    let baseline: BaselineResults | null = null;
    try {
      const raw = await readFile(baselineResultsPath, 'utf-8');
      const parsed = baselineResultsSchema.safeParse(JSON.parse(raw));
      if (parsed.success) baseline = parsed.data;
    } catch {
      // No baseline file; all current failures will be treated as regressions
    }

    const baselineBuildFailures = new Set<string>(baseline?.buildFailures ?? []);
    const baselineTestFailures = new Set<string>(baseline?.testFailures ?? []);
    const allCurrentFailures: string[] = [];
    const allRegressionFailures: string[] = [];

    // Run install command if configured
    if (ctx.config.commands.install) {
      const installResult = await execShell(ctx.config.commands.install, {
        cwd: ctx.worktree.path,
        timeout: 300_000,
      });
      report += `## Install\n\n**Command:** \`${ctx.config.commands.install}\`\n`;
      report += `**Exit Code:** ${installResult.exitCode}\n`;
      report += `**Status:** ${installResult.exitCode === 0 ? 'pass' : 'fail'}\n\n`;
      if (installResult.exitCode !== 0) {
        report += `\`\`\`\n${installResult.stderr}\n\`\`\`\n\n`;
      }
    }

    // Run build command
    if (ctx.config.commands.build && ctx.config.options.buildVerification) {
      report += `## Build\n\n**Command:** \`${ctx.config.commands.build}\`\n`;

      const buildRetry = await runWithRetry({
        command: ctx.config.commands.build,
        cwd: ctx.worktree.path,
        timeout: 300_000,
        maxFixRounds: ctx.config.options.maxIntegrationFixRounds,
        baseline: baselineBuildFailures,
        sentinelValue: '<build-failed-unrecognised-output>',
        onFixNeeded: (output) => this.tryFixIntegration(ctx, output, 'build'),
      });

      allRegressionFailures.push(...buildRetry.regressions);
      allCurrentFailures.push(...buildRetry.failures);
      report += `**Exit Code:** ${buildRetry.exitCode}\n`;
      report += `**Status:** ${buildRetry.exitCode === 0 ? 'pass' : 'fail'}\n\n`;
      if (buildRetry.exitCode !== 0) {
        report += `\`\`\`\n${buildRetry.output}\n\`\`\`\n\n`;
      }
      structuredBuildResult = {
        command: ctx.config.commands.build ?? '',
        exitCode: buildRetry.exitCode,
        signal: null,
        output: buildRetry.output.slice(0, 500),
        pass: buildRetry.exitCode === 0,
      };
    }
    if (ctx.config.commands.test && ctx.config.options.testVerification) {
      report += `## Test\n\n**Command:** \`${ctx.config.commands.test}\`\n`;

      const testRetry = await runWithRetry({
        command: ctx.config.commands.test,
        cwd: ctx.worktree.path,
        timeout: 300_000,
        maxFixRounds: ctx.config.options.maxIntegrationFixRounds,
        baseline: baselineTestFailures,
        sentinelValue: '<test-failed-unrecognised-output>',
        onFixNeeded: (output) => this.tryFixIntegration(ctx, output, 'test'),
      });

      allRegressionFailures.push(...testRetry.regressions);
      allCurrentFailures.push(...testRetry.failures);
      report += `**Exit Code:** ${testRetry.exitCode}\n`;
      report += `**Status:** ${testRetry.exitCode === 0 ? 'pass' : 'fail'}\n\n`;
      if (testRetry.exitCode !== 0) {
        report += `\`\`\`\n${testRetry.output}\n\`\`\`\n\n`;
      }
      structuredTestResult = {
        command: ctx.config.commands.test ?? '',
        exitCode: testRetry.exitCode,
        signal: null,
        output: testRetry.output.slice(0, 500),
        pass: testRetry.exitCode === 0,
      };
    }
    if (ctx.config.commands.lint) {
      const lintResult = await execShell(ctx.config.commands.lint, {
        cwd: ctx.worktree.path,
        timeout: 120_000,
      });
      report += `## Lint\n\n**Command:** \`${ctx.config.commands.lint}\`\n`;
      report += `**Exit Code:** ${lintResult.exitCode}\n`;
      report += `**Status:** ${lintResult.exitCode === 0 ? 'pass' : 'fail'}\n\n`;
      if (lintResult.exitCode !== 0) {
        report += `\`\`\`\n${lintResult.stderr}\n${lintResult.stdout}\n\`\`\`\n\n`;
      }
      structuredLintResult = {
        command: ctx.config.commands.lint ?? '',
        exitCode: lintResult.exitCode,
        signal: lintResult.signal ?? null,
        output: (lintResult.stdout + lintResult.stderr).slice(0, 500),
        pass: lintResult.exitCode === 0,
      };
    }
    const allCurrentFailureSet = new Set<string>(allCurrentFailures);
    const allPreExistingFailures = [...baselineBuildFailures, ...baselineTestFailures].filter((f) =>
      allCurrentFailureSet.has(f),
    );

    report += `## Pre-existing Failures\n\n`;
    if (allPreExistingFailures.length > 0) {
      report += allPreExistingFailures.map((f) => `- ${f}`).join('\n') + '\n\n';
    } else {
      report += '_None_\n\n';
    }

    report += `## New Regressions\n\n`;
    const uniqueRegressionFailures = [...new Set(allRegressionFailures)];
    if (uniqueRegressionFailures.length > 0) {
      report += uniqueRegressionFailures.map((f) => `- ${f}`).join('\n') + '\n\n';
    } else {
      report += '_None_\n\n';
    }

    // Write integration report with structured cadre-json block
    const cadreJson = {
      buildResult: structuredBuildResult ?? { command: ctx.config.commands.build ?? '', exitCode: 0, signal: null, output: '', pass: true },
      testResult: structuredTestResult ?? { command: ctx.config.commands.test ?? '', exitCode: 0, signal: null, output: '', pass: true },
      ...(structuredLintResult ? { lintResult: structuredLintResult } : {}),
      overallPass: uniqueRegressionFailures.length === 0,
      regressionFailures: uniqueRegressionFailures,
      baselineFailures: allPreExistingFailures,
    };
    const fullReport = `# Integration Report: Issue #${ctx.issue.number}\n\n${report}\`\`\`cadre-json\n${JSON.stringify(cadreJson)}\n\`\`\`\n`;
    await writeFile(reportPath, fullReport, 'utf-8');

    // Commit any fixes
    if (!(await ctx.io.commitManager.isClean())) {
      await ctx.io.commitManager.commit(
        'address integration issues',
        ctx.issue.number,
        'fix',
      );
    }

    return reportPath;
  }



  private async tryFixIntegration(ctx: PhaseContext, failureOutput: string, type: string): Promise<void> {
    // Write failure output to a file for fix-surgeon
    const failurePath = join(ctx.io.progressDir, `${type}-failure.txt`);
    await writeFile(failurePath, failureOutput, 'utf-8');

    const changedFiles = await ctx.io.commitManager.getChangedFiles();

    const issueType = type === 'build' ? 'build' : 'test-failure' as const;
    const fixContextPath = await ctx.services.contextBuilder.build('fix-surgeon', {
      issueNumber: ctx.issue.number,
      worktreePath: ctx.worktree.path,
      sessionId: `integration-fix-${issueType}`,
      feedbackPath: failurePath,
      changedFiles: changedFiles.map((f) => join(ctx.worktree.path, f)),
      progressDir: ctx.io.progressDir,
      issueType,
      phase: 4,
    });

    const fixResult = await ctx.services.launcher.launchAgent(
      {
        agent: 'fix-surgeon',
        issueNumber: ctx.issue.number,
        phase: 4,
        contextPath: fixContextPath,
        outputPath: ctx.worktree.path,
      },
      ctx.worktree.path,
    );

    ctx.callbacks.recordTokens('fix-surgeon', fixResult.tokenUsage);
    ctx.callbacks.checkBudget();
  }
}
