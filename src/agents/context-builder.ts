import { join } from 'node:path';
import { atomicWriteJSON, ensureDir } from '../util/fs.js';
import type { CadreConfig } from '../config/schema.js';
import type {
  AgentName,
  AgentContext,
  ImplementationTask,
} from './types.js';
import type { IssueDetail } from '../github/issues.js';
import { Logger } from '../logging/logger.js';

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
    });
  }

  /**
   * Build a context file for the code-writer agent.
   */
  async buildForCodeWriter(
    issueNumber: number,
    worktreePath: string,
    task: ImplementationTask,
    taskPlanPath: string,
    relevantFiles: string[],
    progressDir: string,
  ): Promise<string> {
    return this.writeContext(progressDir, 'code-writer', issueNumber, {
      agent: 'code-writer',
      issueNumber,
      projectName: this.config.projectName,
      repository: this.config.repository,
      worktreePath,
      phase: 3,
      taskId: task.id,
      config: { commands: this.config.commands },
      inputFiles: [taskPlanPath, ...relevantFiles],
      outputPath: worktreePath, // code-writer writes directly to worktree
      payload: {
        taskId: task.id,
        files: task.files,
        acceptanceCriteria: task.acceptanceCriteria,
      },
    });
  }

  /**
   * Build a context file for the test-writer agent.
   */
  async buildForTestWriter(
    issueNumber: number,
    worktreePath: string,
    task: ImplementationTask,
    changedFiles: string[],
    taskPlanPath: string,
    progressDir: string,
  ): Promise<string> {
    return this.writeContext(progressDir, 'test-writer', issueNumber, {
      agent: 'test-writer',
      issueNumber,
      projectName: this.config.projectName,
      repository: this.config.repository,
      worktreePath,
      phase: 3,
      taskId: task.id,
      config: { commands: this.config.commands },
      inputFiles: [...changedFiles, taskPlanPath],
      outputPath: worktreePath,
      payload: {
        taskId: task.id,
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
    task: ImplementationTask,
    diffPath: string,
    taskPlanPath: string,
    progressDir: string,
  ): Promise<string> {
    return this.writeContext(progressDir, 'code-reviewer', issueNumber, {
      agent: 'code-reviewer',
      issueNumber,
      projectName: this.config.projectName,
      repository: this.config.repository,
      worktreePath,
      phase: 3,
      taskId: task.id,
      config: { commands: this.config.commands },
      inputFiles: [diffPath, taskPlanPath],
      outputPath: join(progressDir, `review-${task.id}.md`),
      payload: {
        taskId: task.id,
        acceptanceCriteria: task.acceptanceCriteria,
      },
    });
  }

  /**
   * Build a context file for the fix-surgeon agent.
   */
  async buildForFixSurgeon(
    issueNumber: number,
    worktreePath: string,
    task: ImplementationTask,
    feedbackPath: string,
    changedFiles: string[],
    progressDir: string,
    issueType: 'review' | 'test-failure',
  ): Promise<string> {
    return this.writeContext(progressDir, 'fix-surgeon', issueNumber, {
      agent: 'fix-surgeon',
      issueNumber,
      projectName: this.config.projectName,
      repository: this.config.repository,
      worktreePath,
      phase: 3,
      taskId: task.id,
      config: { commands: this.config.commands },
      inputFiles: [feedbackPath, ...changedFiles],
      outputPath: worktreePath,
      payload: {
        taskId: task.id,
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
    return this.writeContext(progressDir, 'integration-checker', issueNumber, {
      agent: 'integration-checker',
      issueNumber,
      projectName: this.config.projectName,
      repository: this.config.repository,
      worktreePath,
      phase: 4,
      config: { commands: this.config.commands },
      inputFiles: [worktreePath],
      outputPath: join(progressDir, 'integration-report.md'),
      payload: {
        commands: {
          build: this.config.commands.build,
          test: this.config.commands.test,
          lint: this.config.commands.lint,
        },
      },
    });
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
    const taskSuffix = context.taskId ? `-${context.taskId}` : '';
    const filename = `${agent}${taskSuffix}-${timestamp}.json`;
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
