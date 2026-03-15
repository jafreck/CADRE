import { join } from 'node:path';
import type { RuntimeConfig } from '../../config/loader.js';
import type { PhaseResult } from '../../agents/types.js';
import type { IssueDetail, PullRequestInfo, PlatformProvider } from '../../platform/provider.js';
import type { WorktreeInfo } from '../../git/worktree.js';
import { CheckpointManager, IssueProgressWriter, RetryExecutor } from '@cadre-dev/framework/engine';
import { PhaseRegistry, buildRegistry } from './phase-registry.js';
import { type PhaseExecutor, type PhaseContext } from './phase-executor.js';
import { NotificationManager } from '@cadre-dev/framework/notifications';
import { AgentLauncher } from '../agent-launcher.js';
import { ContextBuilder } from '../../agents/context-builder.js';
import { ResultParser } from '../../agents/result-parser.js';
import { CommitManager } from '../../git/commit.js';
import { TokenTracker } from '@cadre-dev/framework/runtime';
import { Logger } from '@cadre-dev/framework/core';
import { IssueNotifier } from '../issue/issue-notifier.js';
import { IssueBudgetGuard, BudgetExceededError } from '../issue/issue-budget-guard.js';
import { GateCoordinator } from './gate-coordinator.js';
import { FlowRunner, defineFlow } from '@cadre-dev/framework/flow';
import type { FlowLifecycleHooks } from '@cadre-dev/framework/flow';
import { createPhaseActions, PipelineHaltError } from './phase-action-callbacks.js';
import type { PipelineFlowContext } from './phase-action-callbacks.js';
import { buildPipelineTopology } from './pipeline-topology.js';

export { BudgetExceededError } from '../issue/issue-budget-guard.js';

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
 *
 * The pipeline topology is declared inline in `run()` using flow DSL
 * primitives (`sequence`, `loop`, `step`, `gate`).  Callback logic lives
 * in {@link createPhaseActions} — small, named factories that return the
 * function for each DSL node.  Lifecycle hooks on the FlowRunner handle
 * cross-cutting concerns (progress updates, notifications).
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
    private readonly resyncAgentFiles?: () => Promise<void>,
  ) {
    this.progressDir = join(
      config.stateDir,
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
      String(issue.number),
      issue.title,
      logger,
    );
    this.tokenTracker = new TokenTracker();

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
   *
   * The flow graph is declared inline so the pipeline topology is visible.
   * Cross-cutting concerns (progress, notifications) are handled by
   * FlowLifecycleHooks on the runner rather than per-phase step nodes.
   */
  async run(): Promise<IssueResult> {
    const startTime = Date.now();
    const resumePoint = this.checkpoint.getResumePoint();

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
        resyncAgentFiles: this.resyncAgentFiles,
        resetPhases: (phaseIds) => this.checkpoint.resetPhases(phaseIds),
      },
    };

    this.logger.info(`Starting pipeline for issue #${this.issue.number}: ${this.issue.title}`, {
      workItemId: String(this.issue.number),
      data: { resumeFrom: resumePoint },
    });

    await this.progressWriter.appendEvent(`Pipeline started (resume from phase ${resumePoint.phase})`);
    await this.dispatchNotification({
      type: 'issue-started',
      workItemId: String(this.issue.number),
      issueTitle: this.issue.title,
      worktreePath: this.worktree.path,
    });

    const executorMap = new Map(
      this.registry.getAll()
        .filter((executor) => !(this.config.options.dryRun && executor.id > 2))
        .map((e) => [e.id, e]),
    );

    const actions = createPhaseActions({
      config: this.config,
      issue: this.issue,
      worktree: this.worktree,
      checkpoint: this.checkpoint,
      logger: this.logger,
      progressWriter: this.progressWriter,
      notificationManager: this.notificationManager,
      commitManager: this.commitManager,
      phases: this.phases,
      phaseHooks: {
        4: {
          beforeCommit: () => this.commitManager.stripCadreFiles(this.worktree.baseCommit),
          ...(this.resyncAgentFiles ? { afterFinalize: this.resyncAgentFiles } : {}),
        },
      },
    });

    const maxGateRetries = this.config.options.maxGateRetries ?? 1;
    const exec = (executor: PhaseExecutor) => this.executePhase(executor);

    // ── Lifecycle hooks: progress + notifications on phase completion ──
    const lifecycleHooks: FlowLifecycleHooks<PipelineFlowContext> = {
      onNodeComplete: async (nodeId) => {
        if (!nodeId.startsWith('phase-')) return;
        const last = this.phases[this.phases.length - 1] as PhaseResult & { skipped?: boolean };
        if (!last || last.skipped || last.duration === 0) return;
        await this.updateProgress();
        await this.dispatchNotification({
          type: 'phase-completed',
          workItemId: String(this.issue.number),
          phase: last.phase,
          phaseName: last.phaseName,
          duration: last.duration,
        });
      },
    };

    // ── Build pipeline topology from PHASE_MANIFEST ──────────────────────
    //
    // Each manifest entry becomes a sequence: gatedStep + finalize (or
    // step + finalize for ungated phases).  Phase 1 additionally gets
    // an ambiguity gate.  Phases chain via dependsOn in manifest order.
    //
    const flowNodes = buildPipelineTopology({
      executorMap,
      actions,
      gateCoordinator,
      phaseCtx: this.ctx,
      executePhase: exec,
      maxGateRetries,
    });

    try {
      await new FlowRunner<PipelineFlowContext>().run(
        defineFlow<PipelineFlowContext>(
          `cadre-issue-${this.issue.number}`,
          flowNodes,
          'Cadre issue execution pipeline',
        ),
        { gatesPassed: {}, gateAttempts: {} },
        { hooks: lifecycleHooks },
      );
    } catch (err) {
      if (this.isBudgetExceededError(err)) {
        const cpState = this.checkpoint.getState();
        cpState.budgetExceeded = true;
        await this.checkpoint.flush();
        await this.progressWriter.appendEvent('Pipeline aborted: token budget exceeded');
        await this.dispatchNotification({
          type: 'issue-failed',
          workItemId: String(this.issue.number),
          issueTitle: this.issue.title,
          error: 'Per-issue token budget exceeded',
          phase: cpState.currentPhase,
        });
        return this.buildResult(false, 'Per-issue token budget exceeded', startTime, true);
      }

      const haltError = this.getPipelineHaltError(err);
      const message = haltError?.message ?? (err instanceof Error ? err.message : String(err));
      await this.dispatchNotification({
        type: 'issue-failed',
        workItemId: String(this.issue.number),
        issueTitle: this.issue.title,
        error: message,
        phase: haltError?.phaseId ?? this.checkpoint.getState().currentPhase,
        phaseName: haltError?.phaseName,
      });
      return this.buildResult(false, message, startTime);
    }

    await this.progressWriter.appendEvent('Pipeline completed successfully');
    const successResult = this.buildResult(true, undefined, startTime);
    await this.dispatchNotification({
      type: 'issue-completed',
      workItemId: String(this.issue.number),
      issueTitle: this.issue.title,
      success: successResult.success,
      duration: successResult.totalDuration,
      tokenUsage: successResult.tokenUsage ?? 0,
    });
    return successResult;
  }

  // ── Error Helpers ──

  private isBudgetExceededError(error: unknown): boolean {
    if (error instanceof BudgetExceededError) return true;
    if (!error || typeof error !== 'object') return false;
    return (error as { cause?: unknown }).cause instanceof BudgetExceededError;
  }

  private getPipelineHaltError(error: unknown): PipelineHaltError | undefined {
    if (error instanceof PipelineHaltError) return error;
    if (!error || typeof error !== 'object') return undefined;
    const cause = (error as { cause?: unknown }).cause;
    return cause instanceof PipelineHaltError ? cause : undefined;
  }

  // ── Phase Execution ──

  /**
   * Execute a single phase.  Thin adapter that delegates to the phase
   * executor and captures timing / error information.
   */
  private async executePhase(executor: PhaseExecutor): Promise<PhaseResult> {
    const phaseStart = Date.now();
    await this.checkpoint.startPhase(executor.id);
    await this.progressWriter.appendEvent(`Phase ${executor.id} started: ${executor.name}`);

    this.logger.info(`Phase ${executor.id}: ${executor.name}`, {
      workItemId: String(this.issue.number),
      phase: executor.id,
    });

    try {
      const outputPath = await executor.execute(this.ctx);
      const duration = Date.now() - phaseStart;
      await this.progressWriter.appendEvent(`Phase ${executor.id} completed in ${duration}ms`);

      return {
        phase: executor.id,
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
      await this.progressWriter.appendEvent(`Phase ${executor.id} failed: ${error}`);

      return {
        phase: executor.id,
        phaseName: executor.name,
        success: false,
        duration,
        tokenUsage: this.tokenTracker.getTotal(),
        error,
      };
    }
  }

  // ── Helpers ──

  /** Fire-and-forget notification dispatch. */
  private async dispatchNotification(event: Record<string, unknown>): Promise<void> {
    await this.notificationManager.dispatch(event as unknown as Parameters<NotificationManager['dispatch']>[0]);
  }

  private async updateProgress(): Promise<void> {
    const cpState = this.checkpoint.getState();
    const taskStatuses: Array<{ id: string; name: string; status: string }> = cpState.completedTasks.map((id) => ({
      id,
      name: id,
      status: 'completed',
    }));
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