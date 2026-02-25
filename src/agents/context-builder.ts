import { join } from 'node:path';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { atomicWriteJSON, ensureDir, exists } from '../util/fs.js';
import type { CadreConfig } from '../config/schema.js';
import type {
  AgentName,
  AgentContext,
  AgentSession,
} from './types.js';
import type { IssueDetail, ReviewThread } from '../platform/provider.js';
import { Logger } from '../logging/logger.js';
import {
  analysisSchema,
  scoutReportSchema,
  implementationPlanSchema,
  reviewSchema,
  integrationReportSchema,
  prContentSchema,
} from './schemas/index.js';

/**
 * Builds per-agent context files.
 * Context files are JSON that tell each agent what inputs to read and where to write outputs.
 */
export class ContextBuilder {
  constructor(
    private readonly config: CadreConfig,
    private readonly logger: Logger,
  ) {}

  /**
   * Build a context file for the issue-analyst agent.
   */
  async buildForIssueAnalyst(
    issueNumber: number,
    worktreePath: string,
    issueJsonPath: string,
    progressDir: string,
  ): Promise<string> {
    return this.writeContext(progressDir, 'issue-analyst', issueNumber, {
      agent: 'issue-analyst',
      issueNumber,
      projectName: this.config.projectName,
      repository: this.config.repository,
      worktreePath,
      phase: 1,
      config: { commands: this.config.commands },
      inputFiles: [issueJsonPath],
      outputPath: join(progressDir, 'analysis.md'),
      outputSchema: zodToJsonSchema(analysisSchema) as Record<string, unknown>,
    });
  }

  /**
   * Build a context file for the codebase-scout agent.
   */
  async buildForCodebaseScout(
    issueNumber: number,
    worktreePath: string,
    analysisPath: string,
    fileTreePath: string,
    progressDir: string,
  ): Promise<string> {
    return this.writeContext(progressDir, 'codebase-scout', issueNumber, {
      agent: 'codebase-scout',
      issueNumber,
      projectName: this.config.projectName,
      repository: this.config.repository,
      worktreePath,
      phase: 1,
      config: { commands: this.config.commands },
      inputFiles: [analysisPath, fileTreePath],
      outputPath: join(progressDir, 'scout-report.md'),
      outputSchema: zodToJsonSchema(scoutReportSchema) as Record<string, unknown>,
    });
  }

  /**
   * Build a context file for the implementation-planner agent.
   */
  async buildForImplementationPlanner(
    issueNumber: number,
    worktreePath: string,
    analysisPath: string,
    scoutReportPath: string,
    progressDir: string,
  ): Promise<string> {
    return this.writeContext(progressDir, 'implementation-planner', issueNumber, {
      agent: 'implementation-planner',
      issueNumber,
      projectName: this.config.projectName,
      repository: this.config.repository,
      worktreePath,
      phase: 2,
      config: { commands: this.config.commands },
      inputFiles: [analysisPath, scoutReportPath],
      outputPath: join(progressDir, 'implementation-plan.md'),
      outputSchema: zodToJsonSchema(implementationPlanSchema) as Record<string, unknown>,
    });
  }

  /**
   * Build a context file for the adjudicator agent.
   */
  async buildForAdjudicator(
    issueNumber: number,
    worktreePath: string,
    planPaths: string[],
    progressDir: string,
  ): Promise<string> {
    return this.writeContext(progressDir, 'adjudicator', issueNumber, {
      agent: 'adjudicator',
      issueNumber,
      projectName: this.config.projectName,
      repository: this.config.repository,
      worktreePath,
      phase: 2,
      config: { commands: this.config.commands },
      inputFiles: planPaths,
      outputPath: join(progressDir, 'adjudication.md'),
      payload: { decisionType: 'implementation-strategy' },
      outputSchema: zodToJsonSchema(implementationPlanSchema) as Record<string, unknown>,
    });
  }

  /**
   * Build a context file for the code-writer agent.
   */
  async buildForCodeWriter(
    issueNumber: number,
    worktreePath: string,
    session: AgentSession,
    sessionPlanPath: string,
    relevantFiles: string[],
    progressDir: string,
    siblingFiles?: string[],
  ): Promise<string> {
    const payload: Record<string, unknown> = {
      sessionId: session.id,
      steps: session.steps,
    };
    if (siblingFiles && siblingFiles.length > 0) {
      payload.siblingFiles = siblingFiles;
    }
    const inputFiles = [sessionPlanPath, ...relevantFiles];
    if (await exists(join(progressDir, 'analysis.md'))) {
      inputFiles.push(join(progressDir, 'analysis.md'));
    }
    if (await exists(join(progressDir, 'scout-report.md'))) {
      inputFiles.push(join(progressDir, 'scout-report.md'));
    }
    return this.writeContext(progressDir, 'code-writer', issueNumber, {
      agent: 'code-writer',
      issueNumber,
      projectName: this.config.projectName,
      repository: this.config.repository,
      worktreePath,
      phase: 3,
      sessionId: session.id,
      config: { commands: this.config.commands },
      inputFiles,
      outputPath: join(worktreePath, '.cadre', 'tasks'), // scratch artifacts stay in .cadre/
      payload,
    });
  }

  /**
   * Build a context file for the test-writer agent.
   */
  async buildForTestWriter(
    issueNumber: number,
    worktreePath: string,
    session: AgentSession,
    changedFiles: string[],
    sessionPlanPath: string,
    progressDir: string,
  ): Promise<string> {
    return this.writeContext(progressDir, 'test-writer', issueNumber, {
      agent: 'test-writer',
      issueNumber,
      projectName: this.config.projectName,
      repository: this.config.repository,
      worktreePath,
      phase: 3,
      sessionId: session.id,
      config: { commands: this.config.commands },
      inputFiles: [...changedFiles, sessionPlanPath],
      outputPath: join(worktreePath, '.cadre', 'tasks'), // scratch artifacts stay in .cadre/
      payload: {
        sessionId: session.id,
        testFramework: this.detectTestFramework(),
      },
    });
  }

  /**
   * Build a context file for the code-reviewer agent.
   */
  async buildForCodeReviewer(
    issueNumber: number,
    worktreePath: string,
    session: AgentSession,
    diffPath: string,
    sessionPlanPath: string,
    progressDir: string,
  ): Promise<string> {
    // Aggregate acceptance criteria from all steps in the session
    const acceptanceCriteria = session.steps.flatMap((s) => s.acceptanceCriteria);
    const inputFiles = [diffPath, sessionPlanPath];
    if (await exists(join(progressDir, 'analysis.md'))) {
      inputFiles.push(join(progressDir, 'analysis.md'));
    }
    if (await exists(join(progressDir, 'scout-report.md'))) {
      inputFiles.push(join(progressDir, 'scout-report.md'));
    }
    return this.writeContext(progressDir, 'code-reviewer', issueNumber, {
      agent: 'code-reviewer',
      issueNumber,
      projectName: this.config.projectName,
      repository: this.config.repository,
      worktreePath,
      phase: 3,
      sessionId: session.id,
      config: { commands: this.config.commands },
      inputFiles,
      outputPath: join(progressDir, `review-${session.id}.md`),
      payload: {
        sessionId: session.id,
        acceptanceCriteria,
      },
      outputSchema: zodToJsonSchema(reviewSchema) as Record<string, unknown>,
    });
  }

  /**
   * Build a context file for the whole-PR code-reviewer agent.
   * Receives the full diff against main/base, all session plan files, and the
   * standard analysis/scout context — giving it cross-session visibility.
   */
  async buildForWholePrCodeReviewer(
    issueNumber: number,
    worktreePath: string,
    diffPath: string,
    sessionPlanPaths: string[],
    progressDir: string,
  ): Promise<string> {
    const inputFiles = [diffPath, ...sessionPlanPaths];
    if (await exists(join(progressDir, 'analysis.md'))) {
      inputFiles.push(join(progressDir, 'analysis.md'));
    }
    if (await exists(join(progressDir, 'scout-report.md'))) {
      inputFiles.push(join(progressDir, 'scout-report.md'));
    }
    if (await exists(join(progressDir, 'implementation-plan.md'))) {
      inputFiles.push(join(progressDir, 'implementation-plan.md'));
    }
    return this.writeContext(progressDir, 'whole-pr-reviewer', issueNumber, {
      agent: 'whole-pr-reviewer',
      issueNumber,
      projectName: this.config.projectName,
      repository: this.config.repository,
      worktreePath,
      phase: 3,
      config: { commands: this.config.commands },
      inputFiles,
      outputPath: join(progressDir, 'whole-pr-review.md'),
      payload: {
        scope: 'whole-pr',
      },
      outputSchema: zodToJsonSchema(reviewSchema) as Record<string, unknown>,
    });
  }

  /**
   * Build a context file for the fix-surgeon agent.
   */
  async buildForFixSurgeon(
    issueNumber: number,
    worktreePath: string,
    sessionId: string,
    feedbackPath: string,
    changedFiles: string[],
    progressDir: string,
    issueType: 'review' | 'test-failure' | 'build',
    phase: 3 | 4,
  ): Promise<string> {
    const inputFiles = [feedbackPath, ...changedFiles];
    const planFile = phase === 3
      ? join(progressDir, `session-${sessionId}.md`)
      : join(progressDir, 'implementation-plan.md');
    if (await exists(planFile)) {
      inputFiles.push(planFile);
    }
    if (await exists(join(progressDir, 'analysis.md'))) {
      inputFiles.push(join(progressDir, 'analysis.md'));
    }
    if (await exists(join(progressDir, 'scout-report.md'))) {
      inputFiles.push(join(progressDir, 'scout-report.md'));
    }
    return this.writeContext(progressDir, 'fix-surgeon', issueNumber, {
      agent: 'fix-surgeon',
      issueNumber,
      projectName: this.config.projectName,
      repository: this.config.repository,
      worktreePath,
      phase,
      sessionId,
      config: { commands: this.config.commands },
      inputFiles,
      outputPath: join(worktreePath, '.cadre', 'tasks'), // scratch artifacts stay in .cadre/
      payload: {
        sessionId,
        issueType,
      },
    });
  }

  /**
   * Build a context file for the integration-checker agent.
   */
  async buildForIntegrationChecker(
    issueNumber: number,
    worktreePath: string,
    progressDir: string,
  ): Promise<string> {
    const inputFiles = [worktreePath];
    const baselinePath = join(worktreePath, '.cadre', 'baseline-results.json');
    if (await exists(baselinePath)) {
      inputFiles.push(baselinePath);
    }
    return this.writeContext(progressDir, 'integration-checker', issueNumber, {
      agent: 'integration-checker',
      issueNumber,
      projectName: this.config.projectName,
      repository: this.config.repository,
      worktreePath,
      phase: 4,
      config: { commands: this.config.commands },
      inputFiles,
      outputPath: join(progressDir, 'integration-report.md'),
      payload: {
        commands: {
          build: this.config.commands.build,
          test: this.config.commands.test,
          lint: this.config.commands.lint,
        },
      },
      outputSchema: zodToJsonSchema(integrationReportSchema) as Record<string, unknown>,
    });
  }

  /**
   * Build a Markdown prompt section summarising unresolved, non-outdated review threads.
   */
  buildForReviewResponse(issue: IssueDetail, reviewThreads: ReviewThread[]): string {
    const active = reviewThreads.filter((t) => !t.isResolved && !t.isOutdated);

    const lines: string[] = [
      `## Review Comments`,
      ``,
      `Issue: #${issue.number} – ${issue.title}`,
      ``,
    ];

    if (active.length === 0) {
      lines.push('_No unresolved review comments._');
    } else {
      for (const thread of active) {
        for (const comment of thread.comments) {
          lines.push(`### ${comment.path}`);
          lines.push(`**Author:** ${comment.author}`);
          lines.push(``);
          lines.push(comment.body);
          lines.push(``);
        }
      }
    }

    return lines.join('\n');
  }

  /**
   * Build a context file for the pr-composer agent.
   */
  async buildForPRComposer(
    issueNumber: number,
    worktreePath: string,
    issue: IssueDetail,
    analysisPath: string,
    planPath: string,
    integrationReportPath: string,
    diffPath: string,
    progressDir: string,
  ): Promise<string> {
    return this.writeContext(progressDir, 'pr-composer', issueNumber, {
      agent: 'pr-composer',
      issueNumber,
      projectName: this.config.projectName,
      repository: this.config.repository,
      worktreePath,
      phase: 5,
      config: { commands: this.config.commands },
      inputFiles: [analysisPath, planPath, integrationReportPath, diffPath],
      outputPath: join(progressDir, 'pr-content.md'),
      payload: {
        issueTitle: issue.title,
        issueBody: issue.body,
      },
      outputSchema: zodToJsonSchema(prContentSchema) as Record<string, unknown>,
    });
  }

  /**
   * Build a context file for the conflict-resolver agent.
   * @param issueNumber   Issue associated with this worktree.
   * @param worktreePath  Absolute path to the worktree root.
   * @param conflictedFiles  Paths (relative to worktreePath) of files with conflict markers.
   * @param progressDir   Directory where context and output files are written.
   */
  async buildForConflictResolver(
    issueNumber: number,
    worktreePath: string,
    conflictedFiles: string[],
    progressDir: string,
  ): Promise<string> {
    return this.writeContext(progressDir, 'conflict-resolver', issueNumber, {
      agent: 'conflict-resolver',
      issueNumber,
      projectName: this.config.projectName,
      repository: this.config.repository,
      worktreePath,
      phase: 0,
      config: { commands: this.config.commands },
      inputFiles: conflictedFiles.map((f) => join(worktreePath, f)),
      outputPath: join(progressDir, 'conflict-resolution-report.md'),
      payload: {
        conflictedFiles,
        baseBranch: this.config.baseBranch,
      },
    });
  }

  /**
   * Write a context JSON file and return the path.
   */
  private async writeContext(
    progressDir: string,
    agent: AgentName,
    issueNumber: number,
    context: AgentContext,
  ): Promise<string> {
    const contextsDir = join(progressDir, 'contexts');
    await ensureDir(contextsDir);

    const timestamp = Date.now();
    const sessionSuffix = context.sessionId ? `-${context.sessionId}` : '';
    const filename = `${agent}${sessionSuffix}-${timestamp}.json`;
    const contextPath = join(contextsDir, filename);

    await atomicWriteJSON(contextPath, context);

    this.logger.debug(`Built context for ${agent}`, {
      issueNumber,
      data: { contextPath, outputPath: context.outputPath },
    });

    return contextPath;
  }

  /**
   * Detect the test framework from the commands config.
   */
  private detectTestFramework(): string {
    const testCmd = this.config.commands.test ?? '';
    if (testCmd.includes('vitest')) return 'vitest';
    if (testCmd.includes('jest')) return 'jest';
    if (testCmd.includes('mocha')) return 'mocha';
    if (testCmd.includes('pytest')) return 'pytest';
    return 'unknown';
  }
}
