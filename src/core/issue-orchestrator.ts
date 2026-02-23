import { join } from 'node:path';
import type { CadreConfig } from '../config/schema.js';
import type {
  AgentInvocation,
  AgentResult,
  PhaseResult,
} from '../agents/types.js';
import type { IssueDetail, PullRequestInfo, PlatformProvider } from '../platform/provider.js';
import type { WorktreeInfo } from '../git/worktree.js';
import { CheckpointManager } from './checkpoint.js';
import { PhaseRegistry, getPhase, type PhaseDefinition } from './phase-registry.js';
import { type PhaseExecutor, type PhaseContext } from './phase-executor.js';
import {
  AnalysisToPlanningGate,
  ImplementationToIntegrationGate,
  IntegrationToPRGate,
  PlanningToImplementationGate,
  type GateContext,
  type PhaseGate,
} from './phase-gate.js';
import { NotificationManager } from '../notifications/manager.js';
import { IssueProgressWriter } from './progress.js';
import { AgentLauncher } from './agent-launcher.js';
import { ContextBuilder } from '../agents/context-builder.js';
import { ResultParser } from '../agents/result-parser.js';
import { CommitManager } from '../git/commit.js';
import { RetryExecutor } from '../execution/retry.js';
import { TokenTracker } from '../budget/token-tracker.js';
import { Logger } from '../logging/logger.js';
import { AnalysisPhaseExecutor } from '../executors/analysis-phase-executor.js';
import { PlanningPhaseExecutor } from '../executors/planning-phase-executor.js';
import { ImplementationPhaseExecutor } from '../executors/implementation-phase-executor.js';
import { IntegrationPhaseExecutor } from '../executors/integration-phase-executor.js';
import { PRCompositionPhaseExecutor } from '../executors/pr-composition-phase-executor.js';

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
  tokenUsage: number | null;
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
  private readonly registry: PhaseRegistry;
  private readonly phases: PhaseResult[] = [];
  private budgetExceeded = false;
  private createdPR: PullRequestInfo | undefined;

  constructor(
    private readonly config: CadreConfig,
    private readonly issue: IssueDetail,
    private readonly worktree: WorktreeInfo,
    private readonly checkpoint: CheckpointManager,
    private readonly launcher: AgentLauncher,
    private readonly platform: PlatformProvider,
    private readonly logger: Logger,
    private readonly notificationManager?: NotificationManager,
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
    this.registry = new PhaseRegistry();
    this.registry.register(new AnalysisPhaseExecutor());
    this.registry.register(new PlanningPhaseExecutor());
    this.registry.register(new ImplementationPhaseExecutor());
    this.registry.register(new IntegrationPhaseExecutor());
    this.registry.register(new PRCompositionPhaseExecutor());
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

    await this.notificationManager?.dispatch({
      type: 'issue-started',
      issueNumber: this.issue.number,
      issueTitle: this.issue.title,
      worktreePath: this.worktree.path,
    });

    for (const executor of this.registry.getAll()) {
      // Skip completed phases on resume
      if (this.checkpoint.isPhaseCompleted(executor.phaseId)) {
        this.logger.info(`Skipping completed phase ${executor.phaseId}: ${executor.name}`, {
          issueNumber: this.issue.number,
          phase: executor.phaseId,
        });
        this.phases.push({
          phase: executor.phaseId,
          phaseName: executor.name,
          success: true,
          duration: 0,
          tokenUsage: 0,
        });
        continue;
      }

      // Dry run stops after phase 2
      if (this.config.options.dryRun && executor.phaseId > 2) {
        this.logger.info(`Dry run: skipping phase ${executor.phaseId}`, {
          issueNumber: this.issue.number,
        });
        break;
      }

      const phaseDef = getPhase(executor.phaseId)!;
      let phaseResult: PhaseResult;
      try {
        phaseResult = await this.executePhase(executor);
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
        await this.checkpoint.completePhase(executor.phaseId, phaseResult.outputPath ?? '');

        // Run gate validators after phases 1–4
        if (executor.phaseId >= 1 && executor.phaseId <= 4) {
          const gateStatus = await this.runGate(executor.phaseId);
          if (gateStatus === 'fail') {
            this.logger.warn(`Gate failed for phase ${executor.phaseId}; retrying`, {
              issueNumber: this.issue.number,
              phase: executor.phaseId,
            });
            await this.progressWriter.appendEvent(`Phase ${executor.phaseId} gate failed; retrying phase`);

            const retryResult = await this.executePhase(executor);
            this.phases[this.phases.length - 1] = retryResult;

            if (!retryResult.success) {
              await this.progressWriter.appendEvent(`Pipeline aborted: phase ${executor.phaseId} retry failed`);
              return this.buildResult(false, retryResult.error, startTime);
            }

            await this.checkpoint.completePhase(executor.phaseId, retryResult.outputPath ?? '');
            const retryGateStatus = await this.runGate(executor.phaseId);
            if (retryGateStatus === 'fail') {
              this.logger.error(`Gate still failing for phase ${executor.phaseId} after retry; aborting`, {
                issueNumber: this.issue.number,
                phase: executor.phaseId,
              });
              await this.progressWriter.appendEvent(
                `Pipeline aborted: gate still failing for phase ${executor.phaseId} after retry`,
              );
              return this.buildResult(
                false,
                `Gate validation failed for phase ${executor.phaseId} after retry`,
                startTime,
              );
            }
          }
        }

        // Commit after phase if configured
        if (this.config.commits.commitPerPhase) {
          await this.commitPhase(phaseDef);
        }

        await this.updateProgress();
      } else if (phaseDef.critical) {
        this.logger.error(`Critical phase ${executor.phaseId} failed, aborting pipeline`, {
          issueNumber: this.issue.number,
          phase: executor.phaseId,
        });
        await this.progressWriter.appendEvent(`Pipeline aborted: phase ${executor.phaseId} failed`);
        await this.notificationManager?.dispatch({
          type: 'issue-failed',
          issueNumber: this.issue.number,
          error: phaseResult.error ?? `Phase ${executor.phaseId} failed`,
          phase: executor.phaseId,
        });
        return this.buildResult(false, phaseResult.error, startTime);
      }
    }

    await this.progressWriter.appendEvent('Pipeline completed successfully');
    const successResult = this.buildResult(true, undefined, startTime);
    await this.notificationManager?.dispatch({
      type: 'issue-completed',
      issueNumber: successResult.issueNumber,
      success: successResult.success,
      duration: successResult.totalDuration,
      tokenUsage: successResult.tokenUsage ?? 0,
    });
    return successResult;
  }

  /**
   * Execute a single phase.
   */
  private async executePhase(executor: PhaseExecutor): Promise<PhaseResult> {
    const phaseStart = Date.now();
    await this.checkpoint.startPhase(executor.phaseId);
    await this.progressWriter.appendEvent(`Phase ${executor.phaseId} started: ${executor.name}`);

    this.logger.info(`Phase ${executor.phaseId}: ${executor.name}`, {
      issueNumber: this.issue.number,
      phase: executor.phaseId,
    });

    try {
      const ctx: PhaseContext = {
        issue: this.issue,
        worktree: this.worktree,
        config: this.config,
        progressDir: this.progressDir,
        contextBuilder: this.contextBuilder,
        launcher: this.launcher,
        resultParser: this.resultParser,
        checkpoint: this.checkpoint,
        commitManager: this.commitManager,
        retryExecutor: this.retryExecutor,
        tokenTracker: this.tokenTracker,
        progressWriter: this.progressWriter,
        platform: this.platform,
        recordTokens: (agent, tokens) => this.recordTokens(agent, tokens),
        checkBudget: () => this.checkBudget(),
        logger: this.logger,
      };

      const outputPath = await executor.execute(ctx);

      const duration = Date.now() - phaseStart;
      await this.progressWriter.appendEvent(`Phase ${executor.phaseId} completed in ${duration}ms`);

      return {
        phase: executor.phaseId,
        phaseName: executor.name,
        success: true,
        duration,
        tokenUsage: this.tokenTracker.getTotal(),
        outputPath,
      };
    } catch (err) {
      if (err instanceof BudgetExceededError) throw err;
      const duration = Date.now() - phaseStart;
      const error = String(err);
      await this.progressWriter.appendEvent(`Phase ${executor.phaseId} failed: ${error}`);

      return {
        phase: executor.phaseId,
        phaseName: executor.name,
        success: false,
        duration,
        tokenUsage: this.tokenTracker.getTotal(),
        error,
      };
    }
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
        tokenUsage: null,
        outputPath: invocation.outputPath,
        outputExists: false,
        error: result.error,
      };
    }

    return result.result;
  }

  private recordTokens(agent: string, tokens: number | null): void {
    if (tokens != null && tokens > 0) {
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

  private async runGate(phaseId: number): Promise<'pass' | 'warn' | 'fail'> {
    const gateMap: Record<number, PhaseGate> = {
      1: new AnalysisToPlanningGate(),
      2: new PlanningToImplementationGate(),
      3: new ImplementationToIntegrationGate(),
      4: new IntegrationToPRGate(),
    };

    const gate = gateMap[phaseId];
    if (!gate) return 'pass';

    const context: GateContext = {
      progressDir: this.progressDir,
      worktreePath: this.worktree.path,
      baseCommit: this.worktree.baseCommit,
    };

    const result = await gate.validate(context);
    await this.checkpoint.recordGateResult(phaseId, result);

    this.phases[this.phases.length - 1] = {
      ...this.phases[this.phases.length - 1],
      gateResult: result,
    };

    if (result.status === 'warn') {
      for (const w of result.warnings) {
        this.logger.warn(`Gate phase ${phaseId}: ${w}`, { issueNumber: this.issue.number, phase: phaseId });
      }
      await this.progressWriter.appendEvent(
        `Gate phase ${phaseId}: passed with ${result.warnings.length} warning(s)`,
      );
    } else if (result.status === 'fail') {
      for (const e of result.errors) {
        this.logger.error(`Gate phase ${phaseId}: ${e}`, { issueNumber: this.issue.number, phase: phaseId });
      }
      await this.progressWriter.appendEvent(`Gate phase ${phaseId} failed: ${result.errors.join('; ')}`);
    } else {
      await this.progressWriter.appendEvent(`Gate phase ${phaseId}: passed`);
    }

    return result.status;
  }

  private buildResult(success: boolean, error?: string, startTime?: number, budgetExceeded?: boolean): IssueResult {
    return {
      issueNumber: this.issue.number,
      issueTitle: this.issue.title,
      success,
      phases: this.phases,
      pr: this.createdPR,
      totalDuration: startTime ? Date.now() - startTime : 0,
      tokenUsage: this.tokenTracker.getTotal(),
      error,
      budgetExceeded,
    };
  }
}
