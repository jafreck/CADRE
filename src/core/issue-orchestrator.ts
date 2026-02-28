import { join } from 'node:path';
import type { RuntimeConfig } from '../config/loader.js';
import type { PhaseResult } from '@cadre/agent-runtime';
import type { IssueDetail, PullRequestInfo, PlatformProvider } from '../platform/provider.js';
import type { WorktreeInfo } from '../git/worktree.js';
import { CheckpointManager } from './checkpoint.js';
import { PhaseRegistry, getPhase, buildRegistry, type PhaseDefinition } from './phase-registry.js';
import { type PhaseExecutor, type PhaseContext } from './phase-executor.js';
import { NotificationManager } from '../notifications/manager.js';
import { IssueProgressWriter } from './progress.js';
import { AgentLauncher } from './agent-launcher.js';
import { ContextBuilder } from '../agents/context-builder.js';
import { ResultParser } from '../agents/result-parser.js';
import { CommitManager } from '../git/commit.js';
import { RetryExecutor } from '../execution/retry.js';
import { TokenTracker } from '../budget/token-tracker.js';
import { Logger } from '../logging/logger.js';
import { IssueNotifier } from './issue-notifier.js';
import { IssueBudgetGuard, BudgetExceededError } from './issue-budget-guard.js';
import { GateCoordinator } from './gate-coordinator.js';
import { IssueLifecycleNotifier } from './issue-lifecycle-notifier.js';

export { BudgetExceededError } from './issue-budget-guard.js';

export interface IssueResult {
  issueNumber: number;
  issueTitle: string;
  success: boolean;
  codeComplete: boolean;
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
  private readonly notificationManager: NotificationManager;
  private readonly registry: PhaseRegistry;
  private ctx!: PhaseContext;
  private readonly phases: PhaseResult[] = [];
  private createdPR: PullRequestInfo | undefined;

  constructor(
    private readonly config: RuntimeConfig,
    private readonly issue: IssueDetail,
    private readonly worktree: WorktreeInfo,
    private readonly checkpoint: CheckpointManager,
    private readonly launcher: AgentLauncher,
    private readonly platform: PlatformProvider,
    private readonly logger: Logger,
    notificationManager?: NotificationManager,
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
      worktree.syncedAgentFiles,
    );
    this.contextBuilder = new ContextBuilder(config, logger);
    this.resultParser = new ResultParser();
    this.retryExecutor = new RetryExecutor(logger);
    this.progressWriter = new IssueProgressWriter(
      this.progressDir,
      issue.number,
      issue.title,
      logger,
    );
    this.tokenTracker = new TokenTracker();

    // Create a fresh, private NotificationManager for this IssueOrchestrator so
    // that IssueNotifier instances do not accumulate on the shared fleet-level
    // manager across multiple issues.  The shared manager (if any) is reached via
    // a lightweight forwarding provider, preserving webhook / Slack / log events
    // without mutating the caller's provider list.
    this.notificationManager = new NotificationManager();
    const notifier = new IssueNotifier(config, platform, logger);
    this.notificationManager.addProvider(notifier);
    if (notificationManager) {
      this.notificationManager.addProvider({
        notify: (event) => notificationManager.dispatch(event),
      });
    }

    this.registry = buildRegistry();
  }

  /**
   * Run the full 5-phase pipeline.
   */
  async run(): Promise<IssueResult> {
    const startTime = Date.now();
    const resumePoint = this.checkpoint.getResumePoint();

    // Instantiate per-run services
    const budgetGuard = new IssueBudgetGuard(
      this.tokenTracker,
      this.notificationManager,
      this.checkpoint,
      this.issue.number,
      this.config.options.tokenBudget,
    );
    const gateCoordinator = new GateCoordinator(
      this.checkpoint,
      this.progressWriter,
      this.logger,
      {
        ambiguityThreshold: this.config.options.ambiguityThreshold,
        haltOnAmbiguity: this.config.options.haltOnAmbiguity,
      },
      this.progressDir,
      this.worktree.path,
      this.worktree.baseCommit,
      this.issue.number,
    );
    const lifecycleNotifier = new IssueLifecycleNotifier(
      this.notificationManager,
      this.issue.number,
      this.issue.title,
    );

    this.ctx = {
      issue: this.issue,
      worktree: this.worktree,
      config: this.config,
      platform: this.platform,
      services: {
        launcher: this.launcher,
        retryExecutor: this.retryExecutor,
        tokenTracker: this.tokenTracker,
        contextBuilder: this.contextBuilder,
        resultParser: this.resultParser,
        logger: this.logger,
      },
      io: {
        progressDir: this.progressDir,
        progressWriter: this.progressWriter,
        checkpoint: this.checkpoint,
        commitManager: this.commitManager,
      },
      callbacks: {
        recordTokens: (agent, tokens) => budgetGuard.recordTokens(agent, tokens),
        checkBudget: () => budgetGuard.checkBudget(),
        updateProgress: () => this.updateProgress(),
        setPR: (pr) => { this.createdPR = pr; },
      },
    };

    this.logger.info(`Starting pipeline for issue #${this.issue.number}: ${this.issue.title}`, {
      issueNumber: this.issue.number,
      data: { resumeFrom: resumePoint },
    });

    await this.progressWriter.appendEvent(`Pipeline started (resume from phase ${resumePoint.phase})`);

    await lifecycleNotifier.notifyIssueStarted(this.worktree.path);

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
          await lifecycleNotifier.notifyIssueFailed('Per-issue token budget exceeded', cpState.currentPhase);
          return this.buildResult(false, 'Per-issue token budget exceeded', startTime, true);
        }
        throw err;
      }
      this.phases.push(phaseResult);

      if (phaseResult.success) {
        await this.checkpoint.completePhase(executor.phaseId, phaseResult.outputPath ?? '');

        // After Phase 1, log ambiguities and notify; halt pipeline if configured
        if (executor.phaseId === 1) {
          const ambiguities = await gateCoordinator.readAmbiguities();
          for (const a of ambiguities) {
            this.logger.warn(`Ambiguity in issue #${this.issue.number}: ${a}`, { issueNumber: this.issue.number });
          }
          if (ambiguities.length > 0) {
            await this.notificationManager.dispatch({
              type: 'ambiguity-detected',
              issueNumber: this.issue.number,
              ambiguities,
            });
          }
          if (
            this.config.options.haltOnAmbiguity &&
            ambiguities.length > this.config.options.ambiguityThreshold
          ) {
            const msg = `Analysis identified ${ambiguities.length} ambiguities (threshold: ${this.config.options.ambiguityThreshold})`;
            await this.progressWriter.appendEvent(`Pipeline halted: ${msg}`);
            return this.buildResult(false, msg, startTime);
          }
        }

        // Run gate validators after phases 1–4
        if (executor.phaseId >= 1 && executor.phaseId <= 4) {
          const gateStatus = await gateCoordinator.runGate(executor.phaseId, this.phases);
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
            const retryGateStatus = await gateCoordinator.runGate(executor.phaseId, this.phases);
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
        await lifecycleNotifier.notifyPhaseCompleted(executor.phaseId, executor.name, phaseResult.duration);
      } else if (phaseDef.critical) {
        this.logger.error(`Critical phase ${executor.phaseId} failed, aborting pipeline`, {
          issueNumber: this.issue.number,
          phase: executor.phaseId,
        });
        await this.progressWriter.appendEvent(`Pipeline aborted: phase ${executor.phaseId} failed`);
        await lifecycleNotifier.notifyIssueFailed(
          phaseResult.error ?? `Phase ${executor.phaseId} failed`,
          executor.phaseId,
          executor.name,
        );
        return this.buildResult(false, phaseResult.error, startTime);
      }
    }

    await this.progressWriter.appendEvent('Pipeline completed successfully');
    const successResult = this.buildResult(true, undefined, startTime);
    await lifecycleNotifier.notifyIssueCompleted(
      successResult.success,
      successResult.totalDuration,
      successResult.tokenUsage ?? 0,
    );
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
      const outputPath = await executor.execute(this.ctx);

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

  private async commitPhase(phase: PhaseDefinition): Promise<void> {
    try {
      const isClean = await this.commitManager.isClean();
      if (!isClean) {
        const type = phase.commitType ?? 'chore';
        const message = (phase.commitMessage ?? `phase ${phase.id} complete`)
          .replace('{issueNumber}', String(this.issue.number));

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

  private buildResult(success: boolean, error?: string, startTime?: number, budgetExceeded?: boolean): IssueResult {
    return {
      issueNumber: this.issue.number,
      issueTitle: this.issue.title,
      success,
      codeComplete: this.phases.some((p) => p.phase === 4 && p.success),
      phases: this.phases,
      pr: this.createdPR,
      totalDuration: startTime ? Date.now() - startTime : 0,
      tokenUsage: this.tokenTracker.getTotal(),
      error,
      budgetExceeded,
    };
  }
}