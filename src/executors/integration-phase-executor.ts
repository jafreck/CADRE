import { join } from 'node:path';
import { writeFile, readFile } from 'node:fs/promises';
import type { PhaseExecutor, PhaseContext } from '../core/phase-executor.js';
import type { ImplementationTask } from '../agents/types.js';
import { execShell } from '../util/process.js';
import { baselineResultsSchema } from '../agents/schemas/index.js';
import type { BaselineResults } from '../agents/schemas/index.js';

export class IntegrationPhaseExecutor implements PhaseExecutor {
  readonly phaseId = 4;
  readonly name = 'Integration Verification';

  async execute(ctx: PhaseContext): Promise<string> {
    const reportPath = join(ctx.progressDir, 'integration-report.md');
    let report = '';

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
      let buildResult = await execShell(ctx.config.commands.build, {
        cwd: ctx.worktree.path,
        timeout: 300_000,
      });
      report += `## Build\n\n**Command:** \`${ctx.config.commands.build}\`\n`;

      let buildOutput = buildResult.stderr + buildResult.stdout;
      let buildFailures = this.extractFailures(buildOutput);
      if (buildResult.exitCode !== 0 && buildFailures.length === 0) {
        buildFailures = ['<build-failed-unrecognised-output>'];
      }
      let buildRegressions = this.computeRegressions(buildFailures, baselineBuildFailures);
      for (let round = 0; round < ctx.config.options.maxIntegrationFixRounds && buildRegressions.length > 0; round++) {
        await this.tryFixIntegration(ctx, buildOutput, 'build');
        buildResult = await execShell(ctx.config.commands.build, {
          cwd: ctx.worktree.path,
          timeout: 300_000,
        });
        buildOutput = buildResult.stderr + buildResult.stdout;
        buildFailures = this.extractFailures(buildOutput);
        if (buildResult.exitCode !== 0 && buildFailures.length === 0) {
          buildFailures = ['<build-failed-unrecognised-output>'];
        }
        buildRegressions = this.computeRegressions(buildFailures, baselineBuildFailures);
      }

      allRegressionFailures.push(...buildRegressions);
      allCurrentFailures.push(...buildFailures);
      report += `**Exit Code:** ${buildResult.exitCode}\n`;
      report += `**Status:** ${buildResult.exitCode === 0 ? 'pass' : 'fail'}\n\n`;
      if (buildResult.exitCode !== 0) {
        report += `\`\`\`\n${buildResult.stderr}\n${buildResult.stdout}\n\`\`\`\n\n`;
      }
    }

    // Run test command
    if (ctx.config.commands.test && ctx.config.options.testVerification) {
      let testResult = await execShell(ctx.config.commands.test, {
        cwd: ctx.worktree.path,
        timeout: 300_000,
      });
      report += `## Test\n\n**Command:** \`${ctx.config.commands.test}\`\n`;

      let testOutput = testResult.stderr + testResult.stdout;
      let testFailures = this.extractFailures(testOutput);
      if (testResult.exitCode !== 0 && testFailures.length === 0) {
        testFailures = ['<test-failed-unrecognised-output>'];
      }
      let testRegressions = this.computeRegressions(testFailures, baselineTestFailures);
      for (let round = 0; round < ctx.config.options.maxIntegrationFixRounds && testRegressions.length > 0; round++) {
        await this.tryFixIntegration(ctx, testOutput, 'test');
        testResult = await execShell(ctx.config.commands.test, {
          cwd: ctx.worktree.path,
          timeout: 300_000,
        });
        testOutput = testResult.stderr + testResult.stdout;
        testFailures = this.extractFailures(testOutput);
        if (testResult.exitCode !== 0 && testFailures.length === 0) {
          testFailures = ['<test-failed-unrecognised-output>'];
        }
        testRegressions = this.computeRegressions(testFailures, baselineTestFailures);
      }

      allRegressionFailures.push(...testRegressions);
      allCurrentFailures.push(...testFailures);
      report += `**Exit Code:** ${testResult.exitCode}\n`;
      report += `**Status:** ${testResult.exitCode === 0 ? 'pass' : 'fail'}\n\n`;
      if (testResult.exitCode !== 0) {
        report += `\`\`\`\n${testResult.stderr}\n${testResult.stdout}\n\`\`\`\n\n`;
      }
    }

    // Run lint command
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
    }

    // Pre-existing failures and new regressions sections
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

    // Write integration report
    const fullReport = `# Integration Report: Issue #${ctx.issue.number}\n\n${report}`;
    await writeFile(reportPath, fullReport, 'utf-8');

    // Commit any fixes
    if (!(await ctx.commitManager.isClean())) {
      await ctx.commitManager.commit(
        'address integration issues',
        ctx.issue.number,
        'fix',
      );
    }

    return reportPath;
  }

  private extractFailures(output: string): string[] {
    const failures = new Set<string>();
    for (const line of output.split('\n')) {
      const trimmed = line.trim();
      // Match common test failure indicators - strip prefix to produce the same format as AnalysisPhaseExecutor
      if (/^(FAIL|FAILED|✗|×)\s+/.test(trimmed)) {
        const match = trimmed.match(/^(?:FAIL|FAILED|✗|×)\s+(.+)/);
        if (match) failures.add(match[1].trim());
      }
      // Match TypeScript/build error lines (no prefix to strip)
      else if (/error TS\d+:/.test(trimmed)) {
        failures.add(trimmed);
      }
      // Match generic error lines (aligned with AnalysisPhaseExecutor)
      else if (/^\s*(error|Error)\s*:/i.test(trimmed) && trimmed.length < 200) {
        failures.add(trimmed);
      }
    }
    return Array.from(failures);
  }

  private computeRegressions(currentFailures: string[], baselineFailures: Set<string>): string[] {
    return currentFailures.filter((f) => !baselineFailures.has(f));
  }

  private async tryFixIntegration(ctx: PhaseContext, failureOutput: string, type: string): Promise<void> {
    // Write failure output to a file for fix-surgeon
    const failurePath = join(ctx.progressDir, `${type}-failure.txt`);
    await writeFile(failurePath, failureOutput, 'utf-8');

    const changedFiles = await ctx.commitManager.getChangedFiles();

    const dummyTask: ImplementationTask = {
      id: `integration-fix-${type}`,
      name: `Fix ${type} failure`,
      description: `Fix ${type} failure detected during integration verification`,
      files: changedFiles,
      dependencies: [],
      complexity: 'moderate',
      acceptanceCriteria: [`${type} command passes`],
    };

    const fixContextPath = await ctx.contextBuilder.buildForFixSurgeon(
      ctx.issue.number,
      ctx.worktree.path,
      dummyTask,
      failurePath,
      changedFiles.map((f) => join(ctx.worktree.path, f)),
      ctx.progressDir,
      'test-failure',
    );

    const fixResult = await ctx.launcher.launchAgent(
      {
        agent: 'fix-surgeon',
        issueNumber: ctx.issue.number,
        phase: 4,
        contextPath: fixContextPath,
        outputPath: ctx.worktree.path,
      },
      ctx.worktree.path,
    );

    ctx.recordTokens('fix-surgeon', fixResult.tokenUsage);
    ctx.checkBudget();
  }
}
