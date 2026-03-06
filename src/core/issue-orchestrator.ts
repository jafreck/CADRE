import { join } from 'node:path';
import type { RuntimeConfig } from '../config/loader.js';
import type { PhaseResult } from '../agents/types.js';
import type { IssueDetail, PullRequestInfo, PlatformProvider } from '../platform/provider.js';
import type { WorktreeInfo } from '../git/worktree.js';
import { CheckpointManager, IssueProgressWriter, RetryExecutor } from '@cadre-dev/framework/engine';
import { PhaseRegistry, getPhase, buildRegistry, type PhaseDefinition } from './phase-registry.js';
import { type PhaseExecutor, type PhaseContext } from './phase-executor.js';
import { NotificationManager } from '@cadre-dev/framework/notifications';
import { AgentLauncher } from './agent-launcher.js';
import { ContextBuilder } from '../agents/context-builder.js';
import { ResultParser } from '../agents/result-parser.js';
import { CommitManager } from '../git/commit.js';
import { TokenTracker } from '@cadre-dev/framework/runtime';
import { Logger } from '@cadre-dev/framework/core';
import { execShell } from '@cadre-dev/framework/runtime';
import { IssueNotifier } from './issue-notifier.js';
import { IssueBudgetGuard, BudgetExceededError } from './issue-budget-guard.js';
import { GateCoordinator } from './gate-coordinator.js';
import { IssueLifecycleNotifier } from './issue-lifecycle-notifier.js';
import { FlowRunner, defineFlow, step, loop, gate, conditional } from '@cadre-dev/framework/flow';
import type { FlowNode } from '@cadre-dev/framework/flow';
import { launchWithRetry } from '../executors/helpers.js';

export { BudgetExceededError } from './issue-budget-guard.js';

/**
 * Pipeline-level flow context shared across all DSL nodes.
 */
interface PipelineFlowContext {
  /** Tracks which phases have passed their gate within the current flow run. */
  gatesPassed: Record<number, boolean>;
  /** Tracks gate retry attempts per phase. */
  gateAttempts: Record<number, number>;
  /** Phases that were checkpoint-skipped (already completed on resume). */
  skippedPhases: Set<number>;
}

class PipelineHaltError extends Error {
  constructor(
    message: string,
    readonly phaseId?: number,
    readonly phaseName?: string,
  ) {
    super(message);
    this.name = 'PipelineHaltError';
  }
}

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
    private readonly resyncAgentFiles?: () => Promise<void>,
  ) {
    // Per-issue working files live under stateDir, not inside the target repo's
    // worktree.  This prevents .cadre/ artifacts from ever appearing in git and
    // removes the need to strip them before PR creation.
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
   * Run the full 5-phase pipeline using flow DSL primitives.
   *
   * The pipeline topology is fully declarative: each phase is expressed as a
   * `loop()` of `step()` + `gate()` for gate retries, with `conditional()`
   * nodes for ambiguity halting and post-phase hooks (strip cadre files,
   * commit-per-phase, agent resync).  FlowRunner handles checkpoint/resume
   * at the flow level.
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
        resyncAgentFiles: this.resyncAgentFiles,
        resetPhases: (phaseIds) => this.checkpoint.resetPhases(phaseIds),
      },
    };

    this.logger.info(`Starting pipeline for issue #${this.issue.number}: ${this.issue.title}`, {
      issueNumber: this.issue.number,
      data: { resumeFrom: resumePoint },
    });

    await this.progressWriter.appendEvent(`Pipeline started (resume from phase ${resumePoint.phase})`);

    await lifecycleNotifier.notifyIssueStarted(this.worktree.path);

    const executors = this.registry.getAll()
      .filter((executor) => !(this.config.options.dryRun && executor.phaseId > 2));

    // Build the declarative flow graph — each phase becomes a sequence of DSL
    // nodes: checkpoint-skip check, phase execution + gate retry loop,
    // ambiguity gate (phase 1), post-phase hooks, and lifecycle notification.
    const flowNodes = this.buildFlowNodes(executors, gateCoordinator, lifecycleNotifier);

    try {
      await new FlowRunner<PipelineFlowContext>().run(
        defineFlow<PipelineFlowContext>(
          `cadre-issue-${this.issue.number}`,
          flowNodes,
          'Cadre issue execution pipeline',
        ),
        { gatesPassed: {}, gateAttempts: {}, skippedPhases: new Set() },
      );
    } catch (err) {
      if (this.isBudgetExceededError(err)) {
        const cpState = this.checkpoint.getState();
        cpState.budgetExceeded = true;
        await this.checkpoint.recordTokenUsage('__budget__', cpState.currentPhase, 0);
        await this.progressWriter.appendEvent('Pipeline aborted: token budget exceeded');
        await lifecycleNotifier.notifyIssueFailed('Per-issue token budget exceeded', cpState.currentPhase);
        return this.buildResult(false, 'Per-issue token budget exceeded', startTime, true);
      }

      const haltError = this.getPipelineHaltError(err);
      const message = haltError?.message ?? (err instanceof Error ? err.message : String(err));
      if (haltError) {
        await lifecycleNotifier.notifyIssueFailed(
          message,
          haltError.phaseId ?? this.checkpoint.getState().currentPhase,
          haltError.phaseName,
        );
      } else {
        await lifecycleNotifier.notifyIssueFailed(message, this.checkpoint.getState().currentPhase);
      }
      return this.buildResult(false, message, startTime);
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

  // ── Flow Graph Construction ──

  /**
   * Build the declarative flow graph for the full pipeline.
   *
   * For each phase executor, produces a sequence of DSL nodes:
   *   1. `conditional` — checkpoint skip (already-completed phases)
   *   2. `loop` — phase execution + gate validation with retries
   *   3. `conditional` — ambiguity halting (phase 1 only)
   *   4. `step` — post-phase hooks (strip cadre files, commit, resync)
   *   5. `step` — lifecycle notification + progress update
   *
   * All nodes for a given phase depend on the previous phase's final node,
   * forming a sequential pipeline that FlowRunner can checkpoint and resume.
   */
  private buildFlowNodes(
    executors: PhaseExecutor[],
    gateCoordinator: GateCoordinator,
    lifecycleNotifier: IssueLifecycleNotifier,
  ): FlowNode<PipelineFlowContext>[] {
    const allNodes: FlowNode<PipelineFlowContext>[] = [];
    let previousNodeId: string | undefined;

    for (const executor of executors) {
      const pid = executor.phaseId;
      const phaseDef = getPhase(pid)!;
      const maxGateRetries = this.config.options.maxGateRetries ?? 1;
      const hasGate = pid >= 1 && pid <= 4;

      // ── Node 1: Checkpoint skip ──
      // If this phase is already completed, push a skip result into phases[]
      // and set gatesPassed so the gate loop exits immediately.
      const skipNodeId = `phase-${pid}-checkpoint-skip`;
      allNodes.push(
        step<PipelineFlowContext>({
          id: skipNodeId,
          dependsOn: previousNodeId ? [previousNodeId] : undefined,
          run: async (ctx) => {
            if (!this.checkpoint.isPhaseCompleted(pid)) {
              return { skipped: false };
            }

            // Defence-in-depth for phase 4: re-run lint to verify validity
            if (
              pid === 4
              && this.config.options.buildVerification
              && this.config.commands?.lint
            ) {
              const lintResult = await execShell(this.config.commands.lint, {
                cwd: this.worktree.path,
                timeout: 300_000,
              });
              if (lintResult.exitCode !== 0) {
                this.logger.warn(
                  `Completed phase 4 no longer passes lint; resetting phases 3-4`,
                  { issueNumber: this.issue.number, phase: pid },
                );
                await this.checkpoint.resetPhases([3, 4]);
                return { skipped: false };
              }
            }

            this.logger.info(`Skipping completed phase ${pid}: ${executor.name}`, {
              issueNumber: this.issue.number,
              phase: pid,
            });
            this.phases.push({
              phase: pid,
              phaseName: executor.name,
              success: true,
              duration: 0,
              tokenUsage: 0,
            });
            // Mark gate as passed so the gate-retry loop exits on first check
            ctx.context.gatesPassed[pid] = true;
            ctx.context.skippedPhases.add(pid);
            return { skipped: true };
          },
        }),
      );

      // ── Node 2: Phase execution + gate retry loop ──
      // Uses loop() to wrap step(executePhase) + gate(runGate).
      // The loop continues while the gate hasn't passed and retries remain.
      if (hasGate) {
        const loopNodeId = `phase-${pid}-with-gate`;
        allNodes.push(
          loop<PipelineFlowContext>({
            id: loopNodeId,
            dependsOn: [skipNodeId],
            maxIterations: maxGateRetries + 1,
            while: (ctx) => !ctx.context.gatesPassed[pid],
            do: [
              step<PipelineFlowContext>({
                id: `phase-${pid}-execute`,
                run: async (ctx) => {
                  const phaseResult = await this.executePhase(executor);
                  const isRetry = (ctx.context.gateAttempts[pid] ?? 0) > 0;

                  if (isRetry) {
                    // Replace last phase result on retry
                    this.phases[this.phases.length - 1] = phaseResult;
                  } else {
                    this.phases.push(phaseResult);
                  }

                  if (!phaseResult.success) {
                    if (isRetry) {
                      await this.progressWriter.appendEvent(
                        `Pipeline aborted: phase ${pid} retry failed`,
                      );
                    }
                    if (phaseDef.critical) {
                      this.logger.error(`Critical phase ${pid} failed, aborting pipeline`, {
                        issueNumber: this.issue.number,
                        phase: pid,
                      });
                      await this.progressWriter.appendEvent(
                        `Pipeline aborted: phase ${pid} failed`,
                      );
                      throw new PipelineHaltError(
                        phaseResult.error ?? `Phase ${pid} ${isRetry ? 'retry ' : ''}failed`,
                        pid,
                        executor.name,
                      );
                    }
                    // Non-critical failure: mark gate as passed to exit loop
                    ctx.context.gatesPassed[pid] = true;
                    return { phaseId: pid, success: false };
                  }

                  await this.checkpoint.completePhase(pid, phaseResult.outputPath ?? '');
                  return { phaseId: pid, success: true };
                },
              }),
              gate<PipelineFlowContext>({
                id: `gate-${pid}`,
                evaluate: async (ctx) => {
                  // If phase already marked as passed (skip or non-critical fail), pass through
                  if (ctx.context.gatesPassed[pid]) return true;

                  const gateStatus = await gateCoordinator.runGate(pid, this.phases);
                  if (gateStatus !== 'fail') {
                    ctx.context.gatesPassed[pid] = true;
                    return true;
                  }

                  // Gate failed — check if retries remain
                  const attempt = (ctx.context.gateAttempts[pid] ?? 0) + 1;
                  ctx.context.gateAttempts[pid] = attempt;

                  if (attempt > maxGateRetries) {
                    // Exhausted retries — abort
                    this.logger.error(
                      `Gate still failing for phase ${pid} after ${maxGateRetries} retries; aborting`,
                      { issueNumber: this.issue.number, phase: pid },
                    );
                    await this.progressWriter.appendEvent(
                      `Pipeline aborted: gate still failing for phase ${pid} after ${maxGateRetries} retries`,
                    );
                    throw new PipelineHaltError(
                      `Gate validation failed for phase ${pid} after retry`,
                      pid,
                      executor.name,
                    );
                  }

                  // Signal retry: log + return true (gate "passes" so the step
                  // inside the loop can re-execute; the loop's while-condition
                  // keeps it spinning because gatesPassed is still false)
                  this.logger.warn(
                    `Gate failed for phase ${pid} (attempt ${attempt}/${maxGateRetries}); retrying`,
                    { issueNumber: this.issue.number, phase: pid },
                  );
                  await this.progressWriter.appendEvent(
                    `Phase ${pid} gate failed; retrying phase (attempt ${attempt}/${maxGateRetries})`,
                  );
                  return true;
                },
              }),
            ],
          }),
        );
        previousNodeId = loopNodeId;
      } else {
        // Phase 5 has no gate — just execute
        const executeNodeId = `phase-${pid}-execute`;
        allNodes.push(
          step<PipelineFlowContext>({
            id: executeNodeId,
            dependsOn: [skipNodeId],
            run: async (ctx) => {
              if (ctx.context.gatesPassed[pid]) {
                return { phaseId: pid, skipped: true };
              }

              const phaseResult = await this.executePhase(executor);
              this.phases.push(phaseResult);

              if (!phaseResult.success) {
                if (phaseDef.critical) {
                  this.logger.error(`Critical phase ${pid} failed, aborting pipeline`, {
                    issueNumber: this.issue.number,
                    phase: pid,
                  });
                  await this.progressWriter.appendEvent(
                    `Pipeline aborted: phase ${pid} failed`,
                  );
                  throw new PipelineHaltError(
                    phaseResult.error ?? `Phase ${pid} failed`,
                    pid,
                    executor.name,
                  );
                }
                return { phaseId: pid, success: false };
              }

              await this.checkpoint.completePhase(pid, phaseResult.outputPath ?? '');
              return { phaseId: pid, success: true };
            },
          }),
        );
        previousNodeId = executeNodeId;
      }

      // ── Node 3: Ambiguity halting (phase 1 only) ──
      if (pid === 1) {
        const ambiguityNodeId = `phase-${pid}-ambiguity-gate`;
        allNodes.push(
          gate<PipelineFlowContext>({
            id: ambiguityNodeId,
            dependsOn: [previousNodeId!],
            evaluate: async () => {
              const ambiguities = await gateCoordinator.readAmbiguities();
              for (const ambiguity of ambiguities) {
                this.logger.warn(`Ambiguity in issue #${this.issue.number}: ${ambiguity}`, {
                  issueNumber: this.issue.number,
                });
              }
              if (ambiguities.length > 0) {
                await this.notificationManager.dispatch({
                  type: 'ambiguity-detected',
                  issueNumber: this.issue.number,
                  ambiguities,
                });
              }
              if (
                this.config.options.haltOnAmbiguity
                && ambiguities.length > this.config.options.ambiguityThreshold
              ) {
                const msg = `Analysis identified ${ambiguities.length} ambiguities (threshold: ${this.config.options.ambiguityThreshold})`;
                await this.progressWriter.appendEvent(`Pipeline halted: ${msg}`);
                throw new PipelineHaltError(msg, pid, executor.name);
              }
              return true;
            },
          }),
        );
        previousNodeId = ambiguityNodeId;
      }

      // ── Node 4: Post-phase hooks ──
      // Strip cadre files (phase 4), commit-per-phase, and agent resync
      // are explicit step nodes visible in the flow graph.
      const postPhaseNodeId = `phase-${pid}-post-hooks`;
      allNodes.push(
        step<PipelineFlowContext>({
          id: postPhaseNodeId,
          dependsOn: [previousNodeId!],
          run: async (ctx) => {
            // Skip hooks for checkpoint-skipped phases
            if (ctx.context.skippedPhases.has(pid)) {
              return { hooked: false };
            }

            if (pid === 4) {
              await this.stripCadreFilesAfterIntegration();
            }

            if (this.config.commits.commitPerPhase) {
              await this.commitPhase(phaseDef);
            }

            // Re-sync agent symlinks AFTER the Phase 4 commit so they don't
            // leak into git history.
            if (pid === 4 && this.resyncAgentFiles) {
              await this.resyncAgentFiles();
            }

            return { hooked: true };
          },
        }),
      );

      // ── Node 5: Lifecycle notification + progress ──
      const notifyNodeId = `phase-${pid}-notify`;
      allNodes.push(
        step<PipelineFlowContext>({
          id: notifyNodeId,
          dependsOn: [postPhaseNodeId],
          run: async (ctx) => {
            // Skip notification for checkpoint-skipped phases
            if (ctx.context.skippedPhases.has(pid)) {
              return { notified: false };
            }

            await this.updateProgress();
            const lastPhase = this.phases.find((p) => p.phase === pid);
            await lifecycleNotifier.notifyPhaseCompleted(
              pid,
              executor.name,
              lastPhase?.duration ?? 0,
            );
            return { notified: true };
          },
        }),
      );

      previousNodeId = notifyNodeId;
    }

    return allNodes;
  }

  // ── Error Helpers ──

  private isBudgetExceededError(error: unknown): boolean {
    if (error instanceof BudgetExceededError) {
      return true;
    }
    if (!error || typeof error !== 'object') {
      return false;
    }
    const cause = (error as { cause?: unknown }).cause;
    return cause instanceof BudgetExceededError;
  }

  private getPipelineHaltError(error: unknown): PipelineHaltError | undefined {
    if (error instanceof PipelineHaltError) {
      return error;
    }
    if (!error || typeof error !== 'object') {
      return undefined;
    }
    const cause = (error as { cause?: unknown }).cause;
    return cause instanceof PipelineHaltError ? cause : undefined;
  }

  // ── Phase Execution ──

  /**
   * Execute a single phase.  This is a thin adapter that delegates to the
   * phase executor and captures timing / error information.
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

  private async stripCadreFilesAfterIntegration(): Promise<void> {
    // stripCadreFiles squashes all commits into one, removing .cadre/ and agent
    // symlinks from git history.  Agent resync happens after commitPerPhase so
    // the resynced files are never staged.
    await this.commitManager.stripCadreFiles(this.worktree.baseCommit);
  }

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