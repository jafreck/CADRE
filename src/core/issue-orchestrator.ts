import { join } from 'node:path';
import { writeFile } from 'node:fs/promises';
import type { CadreConfig } from '../config/schema.js';
import type {
  AgentInvocation,
  AgentResult,
  ImplementationTask,
  PhaseResult,
} from '../agents/types.js';
import type { IssueDetail, PullRequestInfo, PlatformProvider } from '../platform/provider.js';
import type { WorktreeInfo } from '../git/worktree.js';
import { CheckpointManager } from './checkpoint.js';
import { ISSUE_PHASES, type PhaseDefinition } from './phase-registry.js';
import { IssueProgressWriter } from './progress.js';
import { AgentLauncher } from './agent-launcher.js';
import { ContextBuilder } from '../agents/context-builder.js';
import { ResultParser } from '../agents/result-parser.js';
import { CommitManager } from '../git/commit.js';
import { TaskQueue } from '../execution/task-queue.js';
import { RetryExecutor } from '../execution/retry.js';
import { TokenTracker } from '../budget/token-tracker.js';
import { Logger } from '../logging/logger.js';
import { atomicWriteJSON, ensureDir, exists, listFilesRecursive } from '../util/fs.js';
import { execShell } from '../util/process.js';

export class BudgetExceededError extends Error {
  constructor() {
    super('Per-issue token budget exceeded');
    this.name = 'BudgetExceededError';
  }
}

export interface IssueResult {
  issueNumber: number;
  issueTitle: string;
  success: boolean;
  phases: PhaseResult[];
  pr?: PullRequestInfo;
  totalDuration: number;
  tokenUsage: number;
  error?: string;
  budgetExceeded?: boolean;
}

/**
 * Runs the 5-phase pipeline for a single issue within its worktree.
 */
export class IssueOrchestrator {
  private readonly progressDir: string;
  private readonly commitManager: CommitManager;
  private readonly contextBuilder: ContextBuilder;
  private readonly resultParser: ResultParser;
  private readonly retryExecutor: RetryExecutor;
  private readonly progressWriter: IssueProgressWriter;
  private readonly tokenTracker: TokenTracker;
  private readonly phases: PhaseResult[] = [];
  private budgetExceeded = false;

  constructor(
    private readonly config: CadreConfig,
    private readonly issue: IssueDetail,
    private readonly worktree: WorktreeInfo,
    private readonly checkpoint: CheckpointManager,
    private readonly launcher: AgentLauncher,
    private readonly platform: PlatformProvider,
    private readonly logger: Logger,
  ) {
    this.progressDir = join(
      worktree.path,
      '.cadre',
      'issues',
      String(issue.number),
    );
    this.commitManager = new CommitManager(
      worktree.path,
      config.commits,
      logger,
    );
    this.contextBuilder = new ContextBuilder(config, logger);
    this.resultParser = new ResultParser(logger);
    this.retryExecutor = new RetryExecutor(logger);
    this.progressWriter = new IssueProgressWriter(
      this.progressDir,
      issue.number,
      issue.title,
      logger,
    );
    this.tokenTracker = new TokenTracker();
  }

  /**
   * Run the full 5-phase pipeline.
   */
  async run(): Promise<IssueResult> {
    const startTime = Date.now();
    const resumePoint = this.checkpoint.getResumePoint();

    this.logger.info(`Starting pipeline for issue #${this.issue.number}: ${this.issue.title}`, {
      issueNumber: this.issue.number,
      data: { resumeFrom: resumePoint },
    });

    await this.progressWriter.appendEvent(`Pipeline started (resume from phase ${resumePoint.phase})`);

    for (const phase of ISSUE_PHASES) {
      // Skip completed phases on resume
      if (this.checkpoint.isPhaseCompleted(phase.id)) {
        this.logger.info(`Skipping completed phase ${phase.id}: ${phase.name}`, {
          issueNumber: this.issue.number,
          phase: phase.id,
        });
        this.phases.push({
          phase: phase.id,
          phaseName: phase.name,
          success: true,
          duration: 0,
          tokenUsage: 0,
        });
        continue;
      }

      // Dry run stops after phase 2
      if (this.config.options.dryRun && phase.id > 2) {
        this.logger.info(`Dry run: skipping phase ${phase.id}`, {
          issueNumber: this.issue.number,
        });
        break;
      }

      let phaseResult: PhaseResult;
      try {
        phaseResult = await this.executePhase(phase);
      } catch (err) {
        if (err instanceof BudgetExceededError) {
          const cpState = this.checkpoint.getState();
          cpState.budgetExceeded = true;
          // recordTokenUsage always calls save(); this is how we persist budgetExceeded.
          await this.checkpoint.recordTokenUsage('__budget__', cpState.currentPhase, 0);
          this.logger.warn(
            `Issue #${this.issue.number} exceeded per-issue token budget. ` +
            `Increase tokenBudget in cadre.config.json and run with --resume to continue.`,
            { issueNumber: this.issue.number },
          );
          await this.progressWriter.appendEvent('Pipeline aborted: token budget exceeded');
          return this.buildResult(false, 'Per-issue token budget exceeded', startTime, true);
        }
        throw err;
      }
      this.phases.push(phaseResult);

      if (phaseResult.success) {
        await this.checkpoint.completePhase(phase.id, phaseResult.outputPath ?? '');

        // Commit after phase if configured
        if (this.config.commits.commitPerPhase) {
          await this.commitPhase(phase);
        }

        await this.updateProgress();
      } else if (phase.critical) {
        this.logger.error(`Critical phase ${phase.id} failed, aborting pipeline`, {
          issueNumber: this.issue.number,
          phase: phase.id,
        });
        await this.progressWriter.appendEvent(`Pipeline aborted: phase ${phase.id} failed`);
        return this.buildResult(false, phaseResult.error, startTime);
      }
    }

    await this.progressWriter.appendEvent('Pipeline completed successfully');
    return this.buildResult(true, undefined, startTime);
  }

  /**
   * Execute a single phase.
   */
  private async executePhase(phase: PhaseDefinition): Promise<PhaseResult> {
    const phaseStart = Date.now();
    await this.checkpoint.startPhase(phase.id);
    await this.progressWriter.appendEvent(`Phase ${phase.id} started: ${phase.name}`);

    this.logger.info(`Phase ${phase.id}: ${phase.name}`, {
      issueNumber: this.issue.number,
      phase: phase.id,
    });

    try {
      let outputPath = '';

      switch (phase.id) {
        case 1:
          outputPath = await this.executeAnalysisAndScouting();
          break;
        case 2:
          outputPath = await this.executePlanning();
          break;
        case 3:
          outputPath = await this.executeImplementation();
          break;
        case 4:
          outputPath = await this.executeIntegrationVerification();
          break;
        case 5:
          outputPath = await this.executePRComposition();
          break;
      }

      const duration = Date.now() - phaseStart;
      await this.progressWriter.appendEvent(`Phase ${phase.id} completed in ${duration}ms`);

      return {
        phase: phase.id,
        phaseName: phase.name,
        success: true,
        duration,
        tokenUsage: this.tokenTracker.getTotal(),
        outputPath,
      };
    } catch (err) {
      if (err instanceof BudgetExceededError) throw err;
      const duration = Date.now() - phaseStart;
      const error = String(err);
      await this.progressWriter.appendEvent(`Phase ${phase.id} failed: ${error}`);

      return {
        phase: phase.id,
        phaseName: phase.name,
        success: false,
        duration,
        tokenUsage: this.tokenTracker.getTotal(),
        error,
      };
    }
  }

  // ── Phase 1: Analysis & Scouting ──

  private async executeAnalysisAndScouting(): Promise<string> {
    await ensureDir(this.progressDir);

    // Write issue JSON
    const issueJsonPath = join(this.progressDir, 'issue.json');
    await atomicWriteJSON(issueJsonPath, this.issue);

    // Generate file tree
    const fileTreePath = join(this.progressDir, 'repo-file-tree.txt');
    const files = await listFilesRecursive(this.worktree.path);
    const fileTree = files.filter((f) => !f.startsWith('.cadre/')).join('\n');
    await writeFile(fileTreePath, fileTree, 'utf-8');

    // Build contexts for both agents (they can run in parallel)
    const analystContextPath = await this.contextBuilder.buildForIssueAnalyst(
      this.issue.number,
      this.worktree.path,
      issueJsonPath,
      this.progressDir,
    );

    // Launch issue-analyst
    const analystResult = await this.launchWithRetry('issue-analyst', {
      agent: 'issue-analyst',
      issueNumber: this.issue.number,
      phase: 1,
      contextPath: analystContextPath,
      outputPath: join(this.progressDir, 'analysis.md'),
    });

    if (!analystResult.success) {
      throw new Error(`Issue analyst failed: ${analystResult.error}`);
    }

    // Build context for codebase-scout (needs analysis.md)
    const scoutContextPath = await this.contextBuilder.buildForCodebaseScout(
      this.issue.number,
      this.worktree.path,
      join(this.progressDir, 'analysis.md'),
      fileTreePath,
      this.progressDir,
    );

    // Launch codebase-scout
    const scoutResult = await this.launchWithRetry('codebase-scout', {
      agent: 'codebase-scout',
      issueNumber: this.issue.number,
      phase: 1,
      contextPath: scoutContextPath,
      outputPath: join(this.progressDir, 'scout-report.md'),
    });

    if (!scoutResult.success) {
      throw new Error(`Codebase scout failed: ${scoutResult.error}`);
    }

    return join(this.progressDir, 'scout-report.md');
  }

  // ── Phase 2: Planning ──

  private async executePlanning(): Promise<string> {
    const analysisPath = join(this.progressDir, 'analysis.md');
    const scoutReportPath = join(this.progressDir, 'scout-report.md');

    const plannerContextPath = await this.contextBuilder.buildForImplementationPlanner(
      this.issue.number,
      this.worktree.path,
      analysisPath,
      scoutReportPath,
      this.progressDir,
    );

    const plannerResult = await this.launchWithRetry('implementation-planner', {
      agent: 'implementation-planner',
      issueNumber: this.issue.number,
      phase: 2,
      contextPath: plannerContextPath,
      outputPath: join(this.progressDir, 'implementation-plan.md'),
    });

    if (!plannerResult.success) {
      throw new Error(`Implementation planner failed: ${plannerResult.error}`);
    }

    // Validate the plan
    const planPath = join(this.progressDir, 'implementation-plan.md');
    const tasks = await this.resultParser.parseImplementationPlan(planPath);

    if (tasks.length === 0) {
      throw new Error('Implementation plan produced zero tasks');
    }

    // Validate dependency graph is acyclic
    try {
      const queue = new TaskQueue(tasks);
      queue.topologicalSort();
    } catch (err) {
      throw new Error(`Invalid implementation plan: ${err}`);
    }

    this.logger.info(`Plan validated: ${tasks.length} tasks`, {
      issueNumber: this.issue.number,
      phase: 2,
    });

    return planPath;
  }

  // ── Phase 3: Implementation ──

  private async executeImplementation(): Promise<string> {
    const planPath = join(this.progressDir, 'implementation-plan.md');
    const tasks = await this.resultParser.parseImplementationPlan(planPath);

    // Create task queue and restore checkpoint state
    const queue = new TaskQueue(tasks);
    const cpState = this.checkpoint.getState();
    queue.restoreState(cpState.completedTasks, cpState.blockedTasks);

    const maxParallel = this.config.options.maxParallelAgents;

    while (!queue.isComplete()) {
      const readyTasks = queue.getReady();
      if (readyTasks.length === 0) {
        this.logger.warn('No ready tasks but queue not complete — possible deadlock', {
          issueNumber: this.issue.number,
        });
        break;
      }

      // Select non-overlapping batch
      const batch = TaskQueue.selectNonOverlappingBatch(readyTasks, maxParallel);
      this.logger.info(`Implementation batch: ${batch.map((t) => t.id).join(', ')}`, {
        issueNumber: this.issue.number,
        phase: 3,
      });

      // Process batch (tasks can run concurrently if they don't share files)
      const batchPromises = batch.map((task) => this.executeTask(task, queue));
      await Promise.all(batchPromises);

      await this.updateProgress();
    }

    const counts = queue.getCounts();
    this.logger.info(
      `Implementation complete: ${counts.completed}/${counts.total} tasks (${counts.blocked} blocked)`,
      { issueNumber: this.issue.number, phase: 3 },
    );

    if (counts.blocked > 0 && counts.completed === 0) {
      throw new Error('All implementation tasks blocked');
    }

    return planPath;
  }

  private async executeTask(task: ImplementationTask, queue: TaskQueue): Promise<void> {
    if (this.checkpoint.isTaskCompleted(task.id)) {
      queue.complete(task.id);
      return;
    }

    queue.start(task.id);
    await this.checkpoint.startTask(task.id);
    await this.progressWriter.appendEvent(`Task ${task.id} started: ${task.name}`);

    const maxRetries = this.config.options.maxRetriesPerTask;

    const retryResult = await this.retryExecutor.execute({
      fn: async (attempt) => {
        this.checkBudget();
        // 1. Write task plan slice
        const taskPlanPath = join(this.progressDir, `task-${task.id}.md`);
        const taskPlanContent = this.buildTaskPlanSlice(task);
        await writeFile(taskPlanPath, taskPlanContent, 'utf-8');

        // 2. Launch code-writer
        const writerContextPath = await this.contextBuilder.buildForCodeWriter(
          this.issue.number,
          this.worktree.path,
          task,
          taskPlanPath,
          task.files.map((f) => join(this.worktree.path, f)),
          this.progressDir,
        );

        const writerResult = await this.launcher.launchAgent(
          {
            agent: 'code-writer',
            issueNumber: this.issue.number,
            phase: 3,
            taskId: task.id,
            contextPath: writerContextPath,
            outputPath: this.worktree.path,
          },
          this.worktree.path,
        );

        this.recordTokens('code-writer', writerResult.tokenUsage);
        this.checkBudget();

        if (!writerResult.success) {
          throw new Error(`Code writer failed: ${writerResult.error}`);
        }

        // 3. Launch test-writer
        const changedFiles = await this.commitManager.getChangedFiles();
        const testWriterContextPath = await this.contextBuilder.buildForTestWriter(
          this.issue.number,
          this.worktree.path,
          task,
          changedFiles.map((f) => join(this.worktree.path, f)),
          taskPlanPath,
          this.progressDir,
        );

        const testResult = await this.launcher.launchAgent(
          {
            agent: 'test-writer',
            issueNumber: this.issue.number,
            phase: 3,
            taskId: task.id,
            contextPath: testWriterContextPath,
            outputPath: this.worktree.path,
          },
          this.worktree.path,
        );

        this.recordTokens('test-writer', testResult.tokenUsage);
        this.checkBudget();

        // 4. Launch code-reviewer
        const diffPath = join(this.progressDir, `diff-${task.id}.patch`);
        const diff = await this.commitManager.getDiff(this.worktree.baseCommit);
        await writeFile(diffPath, diff, 'utf-8');

        const reviewerContextPath = await this.contextBuilder.buildForCodeReviewer(
          this.issue.number,
          this.worktree.path,
          task,
          diffPath,
          taskPlanPath,
          this.progressDir,
        );

        const reviewResult = await this.launcher.launchAgent(
          {
            agent: 'code-reviewer',
            issueNumber: this.issue.number,
            phase: 3,
            taskId: task.id,
            contextPath: reviewerContextPath,
            outputPath: join(this.progressDir, `review-${task.id}.md`),
          },
          this.worktree.path,
        );

        this.recordTokens('code-reviewer', reviewResult.tokenUsage);
        this.checkBudget();

        // 5. Check review verdict
        if (reviewResult.success) {
          const reviewPath = join(this.progressDir, `review-${task.id}.md`);
          if (await exists(reviewPath)) {
            const review = await this.resultParser.parseReview(reviewPath);
            if (review.verdict === 'needs-fixes') {
              // Launch fix-surgeon
              const fixContextPath = await this.contextBuilder.buildForFixSurgeon(
                this.issue.number,
                this.worktree.path,
                task,
                reviewPath,
                changedFiles.map((f) => join(this.worktree.path, f)),
                this.progressDir,
                'review',
              );

              const fixResult = await this.launcher.launchAgent(
                {
                  agent: 'fix-surgeon',
                  issueNumber: this.issue.number,
                  phase: 3,
                  taskId: task.id,
                  contextPath: fixContextPath,
                  outputPath: this.worktree.path,
                },
                this.worktree.path,
              );

              this.recordTokens('fix-surgeon', fixResult.tokenUsage);
              this.checkBudget();

              if (!fixResult.success) {
                throw new Error(`Fix surgeon failed: ${fixResult.error}`);
              }
            }
          }
        }

        return true;
      },
      maxAttempts: maxRetries,
      description: `Task ${task.id}: ${task.name}`,
    });

    this.checkBudget();

    if (retryResult.success) {
      queue.complete(task.id);
      await this.checkpoint.completeTask(task.id);
      await this.progressWriter.appendEvent(`Task ${task.id} completed`);

      // Commit task
      await this.commitManager.commit(
        `implement ${task.name}`,
        this.issue.number,
        'feat',
      );
    } else {
      queue.markBlocked(task.id);
      await this.checkpoint.blockTask(task.id);
      await this.progressWriter.appendEvent(`Task ${task.id} blocked: ${retryResult.error}`);
    }
  }

  // ── Phase 4: Integration Verification ──

  private async executeIntegrationVerification(): Promise<string> {
    const reportPath = join(this.progressDir, 'integration-report.md');
    let report = '';

    // Run install command if configured
    if (this.config.commands.install) {
      const installResult = await execShell(this.config.commands.install, {
        cwd: this.worktree.path,
        timeout: 300_000,
      });
      report += `## Install\n\n**Command:** \`${this.config.commands.install}\`\n`;
      report += `**Exit Code:** ${installResult.exitCode}\n`;
      report += `**Status:** ${installResult.exitCode === 0 ? 'pass' : 'fail'}\n\n`;
      if (installResult.exitCode !== 0) {
        report += `\`\`\`\n${installResult.stderr}\n\`\`\`\n\n`;
      }
    }

    // Run build command
    if (this.config.commands.build && this.config.options.buildVerification) {
      const buildResult = await execShell(this.config.commands.build, {
        cwd: this.worktree.path,
        timeout: 300_000,
      });
      report += `## Build\n\n**Command:** \`${this.config.commands.build}\`\n`;
      report += `**Exit Code:** ${buildResult.exitCode}\n`;
      report += `**Status:** ${buildResult.exitCode === 0 ? 'pass' : 'fail'}\n\n`;
      if (buildResult.exitCode !== 0) {
        report += `\`\`\`\n${buildResult.stderr}\n${buildResult.stdout}\n\`\`\`\n\n`;

        // Try fix-surgeon for build failure
        await this.tryFixIntegration(buildResult.stderr + buildResult.stdout, 'build');
      }
    }

    // Run test command
    if (this.config.commands.test && this.config.options.testVerification) {
      const testResult = await execShell(this.config.commands.test, {
        cwd: this.worktree.path,
        timeout: 300_000,
      });
      report += `## Test\n\n**Command:** \`${this.config.commands.test}\`\n`;
      report += `**Exit Code:** ${testResult.exitCode}\n`;
      report += `**Status:** ${testResult.exitCode === 0 ? 'pass' : 'fail'}\n\n`;
      if (testResult.exitCode !== 0) {
        report += `\`\`\`\n${testResult.stderr}\n${testResult.stdout}\n\`\`\`\n\n`;

        // Try fix-surgeon for test failure
        await this.tryFixIntegration(testResult.stderr + testResult.stdout, 'test');
      }
    }

    // Run lint command
    if (this.config.commands.lint) {
      const lintResult = await execShell(this.config.commands.lint, {
        cwd: this.worktree.path,
        timeout: 120_000,
      });
      report += `## Lint\n\n**Command:** \`${this.config.commands.lint}\`\n`;
      report += `**Exit Code:** ${lintResult.exitCode}\n`;
      report += `**Status:** ${lintResult.exitCode === 0 ? 'pass' : 'fail'}\n\n`;
      if (lintResult.exitCode !== 0) {
        report += `\`\`\`\n${lintResult.stderr}\n${lintResult.stdout}\n\`\`\`\n\n`;
      }
    }

    // Write integration report
    const fullReport = `# Integration Report: Issue #${this.issue.number}\n\n${report}`;
    await writeFile(reportPath, fullReport, 'utf-8');

    // Commit any fixes
    if (!(await this.commitManager.isClean())) {
      await this.commitManager.commit(
        'address integration issues',
        this.issue.number,
        'fix',
      );
    }

    return reportPath;
  }

  private async tryFixIntegration(failureOutput: string, type: string): Promise<void> {
    // Write failure output to a file for fix-surgeon
    const failurePath = join(this.progressDir, `${type}-failure.txt`);
    await writeFile(failurePath, failureOutput, 'utf-8');

    const changedFiles = await this.commitManager.getChangedFiles();

    const dummyTask: ImplementationTask = {
      id: `integration-fix-${type}`,
      name: `Fix ${type} failure`,
      description: `Fix ${type} failure detected during integration verification`,
      files: changedFiles,
      dependencies: [],
      complexity: 'moderate',
      acceptanceCriteria: [`${type} command passes`],
    };

    const fixContextPath = await this.contextBuilder.buildForFixSurgeon(
      this.issue.number,
      this.worktree.path,
      dummyTask,
      failurePath,
      changedFiles.map((f) => join(this.worktree.path, f)),
      this.progressDir,
      'test-failure',
    );

    const fixResult = await this.launcher.launchAgent(
      {
        agent: 'fix-surgeon',
        issueNumber: this.issue.number,
        phase: 4,
        contextPath: fixContextPath,
        outputPath: this.worktree.path,
      },
      this.worktree.path,
    );

    this.recordTokens('fix-surgeon', fixResult.tokenUsage);
    this.checkBudget();
  }

  // ── Phase 5: PR Composition ──

  private async executePRComposition(): Promise<string> {
    const analysisPath = join(this.progressDir, 'analysis.md');
    const planPath = join(this.progressDir, 'implementation-plan.md');
    const integrationReportPath = join(this.progressDir, 'integration-report.md');

    // Generate diff
    const diffPath = join(this.progressDir, 'full-diff.patch');
    const diff = await this.commitManager.getDiff(this.worktree.baseCommit);
    await writeFile(diffPath, diff, 'utf-8');

    // Launch pr-composer
    const composerContextPath = await this.contextBuilder.buildForPRComposer(
      this.issue.number,
      this.worktree.path,
      this.issue,
      analysisPath,
      planPath,
      integrationReportPath,
      diffPath,
      this.progressDir,
    );

    const composerResult = await this.launchWithRetry('pr-composer', {
      agent: 'pr-composer',
      issueNumber: this.issue.number,
      phase: 5,
      contextPath: composerContextPath,
      outputPath: join(this.progressDir, 'pr-content.md'),
    });

    if (!composerResult.success) {
      throw new Error(`PR composer failed: ${composerResult.error}`);
    }

    // Create PR if auto-create is enabled
    if (this.config.pullRequest.autoCreate) {
      const prContentPath = join(this.progressDir, 'pr-content.md');
      const prContent = await this.resultParser.parsePRContent(prContentPath);

      // Squash if configured
      if (this.config.commits.squashBeforePR) {
        await this.commitManager.squash(
          this.worktree.baseCommit,
          prContent.title || `Fix #${this.issue.number}: ${this.issue.title}`,
        );
      }

      // Push
      await this.commitManager.push(true);

      // Create PR
      try {
        const prTitle = `${prContent.title || this.issue.title} (#${this.issue.number})`;
        let prBody = prContent.body;

        // Add issue link if configured
        if (this.config.pullRequest.linkIssue) {
          prBody += `\n\n${this.platform.issueLinkSuffix(this.issue.number)}`;
        }

        const pr = await this.platform.createPullRequest({
          title: prTitle,
          body: prBody,
          head: this.worktree.branch,
          base: this.config.baseBranch,
          draft: this.config.pullRequest.draft,
        });

        // Store PR info
        // The fleet orchestrator will collect this
        this.logger.info(`PR created: #${pr.number}`, {
          issueNumber: this.issue.number,
          data: { prUrl: pr.url },
        });
      } catch (err) {
        // Non-critical: the branch is pushed, PR can be created manually
        this.logger.error(`Failed to create PR: ${err}`, {
          issueNumber: this.issue.number,
        });
      }
    }

    return join(this.progressDir, 'pr-content.md');
  }

  // ── Helper Methods ──

  private async launchWithRetry(
    agentName: string,
    invocation: Omit<AgentInvocation, 'timeout'>,
  ): Promise<AgentResult> {
    const result = await this.retryExecutor.execute<AgentResult>({
      fn: async () => {
        this.checkBudget();
        const agentResult = await this.launcher.launchAgent(
          invocation as AgentInvocation,
          this.worktree.path,
        );
        this.recordTokens(agentName, agentResult.tokenUsage);
        this.checkBudget();
        if (!agentResult.success) {
          throw new Error(agentResult.error ?? `Agent ${agentName} failed`);
        }
        return agentResult;
      },
      maxAttempts: this.config.options.maxRetriesPerTask,
      description: agentName,
    });

    this.checkBudget();

    if (!result.success || !result.result) {
      return {
        agent: invocation.agent,
        success: false,
        exitCode: 1,
        timedOut: false,
        duration: 0,
        stdout: '',
        stderr: result.error ?? 'Unknown failure',
        tokenUsage: 0,
        outputPath: invocation.outputPath,
        outputExists: false,
        error: result.error,
      };
    }

    return result.result;
  }

  private recordTokens(agent: string, tokens: number): void {
    if (tokens > 0) {
      this.tokenTracker.record(
        this.issue.number,
        agent,
        this.checkpoint.getState().currentPhase,
        tokens,
      );
      void this.checkpoint.recordTokenUsage(
        agent,
        this.checkpoint.getState().currentPhase,
        tokens,
      );
    }
    if (
      !this.budgetExceeded &&
      this.tokenTracker.checkIssueBudget(this.issue.number, this.config.options.tokenBudget) === 'exceeded'
    ) {
      this.budgetExceeded = true;
    }
  }

  private checkBudget(): void {
    if (this.budgetExceeded) throw new BudgetExceededError();
  }

  private async commitPhase(phase: PhaseDefinition): Promise<void> {
    try {
      const isClean = await this.commitManager.isClean();
      if (!isClean) {
        const type = phase.id <= 2 ? 'chore' : phase.id === 3 ? 'feat' : 'fix';
        const message =
          phase.id === 1
            ? `analyze issue #${this.issue.number}`
            : phase.id === 2
              ? `plan implementation for #${this.issue.number}`
              : phase.id === 4
                ? `address integration issues`
                : `phase ${phase.id} complete`;

        await this.commitManager.commit(message, this.issue.number, type);
      }
    } catch (err) {
      this.logger.warn(`Failed to commit after phase ${phase.id}: ${err}`, {
        issueNumber: this.issue.number,
      });
    }
  }

  private async updateProgress(): Promise<void> {
    const cpState = this.checkpoint.getState();
    const taskStatuses: Array<{ id: string; name: string; status: string }> = cpState.completedTasks.map((id) => ({
      id,
      name: id,
      status: 'completed',
    }));

    // Add blocked tasks
    for (const id of cpState.blockedTasks) {
      taskStatuses.push({ id, name: id, status: 'blocked' });
    }

    await this.progressWriter.write(
      this.phases,
      cpState.currentPhase,
      taskStatuses,
      this.tokenTracker.getTotal(),
    );
  }

  private buildTaskPlanSlice(task: ImplementationTask): string {
    return [
      `# Task: ${task.id} - ${task.name}`,
      '',
      `**Description:** ${task.description}`,
      `**Files:** ${task.files.join(', ')}`,
      `**Dependencies:** ${task.dependencies.length === 0 ? 'none' : task.dependencies.join(', ')}`,
      `**Complexity:** ${task.complexity}`,
      `**Acceptance Criteria:**`,
      ...task.acceptanceCriteria.map((c) => `- ${c}`),
    ].join('\n');
  }

  private buildResult(success: boolean, error?: string, startTime?: number, budgetExceeded?: boolean): IssueResult {
    return {
      issueNumber: this.issue.number,
      issueTitle: this.issue.title,
      success,
      phases: this.phases,
      totalDuration: startTime ? Date.now() - startTime : 0,
      tokenUsage: this.tokenTracker.getTotal(),
      error,
      budgetExceeded,
    };
  }
}
