import { join } from 'node:path';
import { writeFile } from 'node:fs/promises';
import type { PhaseExecutor, PhaseContext } from '../core/phase-executor.js';
import type { ImplementationTask } from '../agents/types.js';
import { execShell } from '../util/process.js';

export class IntegrationPhaseExecutor implements PhaseExecutor {
  readonly phaseId = 4;
  readonly name = 'Integration Verification';

  async execute(ctx: PhaseContext): Promise<string> {
    const reportPath = join(ctx.progressDir, 'integration-report.md');
    let report = '';

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
      const buildResult = await execShell(ctx.config.commands.build, {
        cwd: ctx.worktree.path,
        timeout: 300_000,
      });
      report += `## Build\n\n**Command:** \`${ctx.config.commands.build}\`\n`;
      report += `**Exit Code:** ${buildResult.exitCode}\n`;
      report += `**Status:** ${buildResult.exitCode === 0 ? 'pass' : 'fail'}\n\n`;
      if (buildResult.exitCode !== 0) {
        report += `\`\`\`\n${buildResult.stderr}\n${buildResult.stdout}\n\`\`\`\n\n`;

        // Try fix-surgeon for build failure
        await this.tryFixIntegration(ctx, buildResult.stderr + buildResult.stdout, 'build');
      }
    }

    // Run test command
    if (ctx.config.commands.test && ctx.config.options.testVerification) {
      const testResult = await execShell(ctx.config.commands.test, {
        cwd: ctx.worktree.path,
        timeout: 300_000,
      });
      report += `## Test\n\n**Command:** \`${ctx.config.commands.test}\`\n`;
      report += `**Exit Code:** ${testResult.exitCode}\n`;
      report += `**Status:** ${testResult.exitCode === 0 ? 'pass' : 'fail'}\n\n`;
      if (testResult.exitCode !== 0) {
        report += `\`\`\`\n${testResult.stderr}\n${testResult.stdout}\n\`\`\`\n\n`;

        // Try fix-surgeon for test failure
        await this.tryFixIntegration(ctx, testResult.stderr + testResult.stdout, 'test');
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
