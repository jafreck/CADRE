/**
 * Constructs the declarative flow graph for the per-issue pipeline.
 *
 * Each phase is expressed as a sequence of DSL nodes:
 *   1. `loop` — phase execution + gate validation with retries
 *      (checkpoint skip is handled by the loop's `while` guard)
 *   2. `gate` — ambiguity halting (phase 1 only)
 *   3. `step` — post-phase hooks (strip cadre files, commit, resync)
 *   4. `step` — lifecycle notification + progress update
 *
 * All nodes for a given phase depend on the previous phase's final node,
 * forming a sequential pipeline that FlowRunner can checkpoint and resume.
 */

import type { PhaseResult } from '../agents/types.js';
import type { RuntimeConfig } from '../config/loader.js';
import type { IssueDetail } from '../platform/provider.js';
import type { WorktreeInfo } from '../git/worktree.js';
import type { CheckpointManager, IssueProgressWriter } from '@cadre-dev/framework/engine';
import type { Logger } from '@cadre-dev/framework/core';
import type { NotificationManager } from '@cadre-dev/framework/notifications';
import type { CommitManager } from '../git/commit.js';
import type { PhaseExecutor, PhaseContext } from './phase-executor.js';
import type { PhaseDefinition } from './phase-registry.js';
import type { GateCoordinator } from './gate-coordinator.js';
import type { IssueLifecycleNotifier } from './issue-lifecycle-notifier.js';
import { getPhase } from './phase-registry.js';
import { step, loop, gate } from '@cadre-dev/framework/flow';
import type { FlowNode } from '@cadre-dev/framework/flow';

/**
 * Pipeline-level flow context shared across all DSL nodes.
 */
export interface PipelineFlowContext {
  /** Tracks which phases have passed their gate within the current flow run. */
  gatesPassed: Record<number, boolean>;
  /** Tracks gate retry attempts per phase. */
  gateAttempts: Record<number, number>;
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

export { PipelineHaltError };

/** Dependencies injected by the orchestrator. */
export interface FlowBuilderDeps {
  config: RuntimeConfig;
  issue: IssueDetail;
  worktree: WorktreeInfo;
  checkpoint: CheckpointManager;
  logger: Logger;
  progressWriter: IssueProgressWriter;
  notificationManager: NotificationManager;
  commitManager: CommitManager;
  resyncAgentFiles?: () => Promise<void>;
  /** Returns the current cumulative token usage. */
  getTokenUsage: () => number | null;
}

export class PhaseFlowBuilder {
  /** Phases that were checkpoint-skipped (set during flow execution). */
  private readonly skippedPhases = new Set<number>();
  /** Phases that were freshly executed (not checkpoint-skipped). */
  private readonly executedPhases = new Set<number>();

  constructor(
    private readonly deps: FlowBuilderDeps,
    /** Mutable phases array shared with the orchestrator for mid-run consumers. */
    private readonly phases: PhaseResult[],
  ) {}

  /**
   * Build the complete flow graph for the given executors.
   */
  build(
    executors: PhaseExecutor[],
    gateCoordinator: GateCoordinator,
    lifecycleNotifier: IssueLifecycleNotifier,
    ctx: PhaseContext,
    executePhase: (executor: PhaseExecutor) => Promise<PhaseResult>,
  ): FlowNode<PipelineFlowContext>[] {
    const allNodes: FlowNode<PipelineFlowContext>[] = [];
    let previousNodeId: string | undefined;

    for (const executor of executors) {
      const nodes = this.buildPhaseNodes(
        executor,
        gateCoordinator,
        lifecycleNotifier,
        ctx,
        executePhase,
        previousNodeId,
      );
      allNodes.push(...nodes.nodes);
      previousNodeId = nodes.lastNodeId;
    }

    return allNodes;
  }

  // ── Per-Phase Node Builders ──

  private buildPhaseNodes(
    executor: PhaseExecutor,
    gateCoordinator: GateCoordinator,
    lifecycleNotifier: IssueLifecycleNotifier,
    ctx: PhaseContext,
    executePhase: (executor: PhaseExecutor) => Promise<PhaseResult>,
    previousNodeId: string | undefined,
  ): { nodes: FlowNode<PipelineFlowContext>[]; lastNodeId: string } {
    const pid = executor.phaseId;
    const hasGate = pid >= 1 && pid <= 4;
    const nodes: FlowNode<PipelineFlowContext>[] = [];

    // ── Phase execution (+ gate retry loop for phases 1-4) ──
    let executeLastId: string;
    if (hasGate) {
      const gateLoop = this.buildGateLoop(executor, gateCoordinator, ctx, executePhase, previousNodeId);
      nodes.push(gateLoop);
      executeLastId = gateLoop.id;
    } else {
      const execNode = this.buildExecuteStep(executor, executePhase, previousNodeId);
      nodes.push(execNode);
      executeLastId = execNode.id;
    }

    // ── Ambiguity halting (phase 1 only) ──
    let lastId = executeLastId;
    if (pid === 1) {
      const ambiguityNode = this.buildAmbiguityGate(executor, gateCoordinator, lastId);
      nodes.push(ambiguityNode);
      lastId = ambiguityNode.id;
    }

    // ── Post-phase hooks ──
    const postHooks = this.buildPostHooks(executor, lastId);
    nodes.push(postHooks);

    // ── Lifecycle notification ──
    const notify = this.buildNotify(executor, lifecycleNotifier, postHooks.id);
    nodes.push(notify);

    return { nodes, lastNodeId: notify.id };
  }

  /**
   * Build a `loop(while: !completed && !passed, do: [execute, gate])` node
   * for phases with gate validation.
   *
   * The `while` guard folds checkpoint-skip detection:
   * - If the phase is already completed (and validates via `validatePriorCompletion`),
   *   the loop runs 0 iterations — the phase is skipped.
   * - Otherwise, the loop runs execute + gate, retrying on gate failure.
   */
  private buildGateLoop(
    executor: PhaseExecutor,
    gateCoordinator: GateCoordinator,
    ctx: PhaseContext,
    executePhase: (executor: PhaseExecutor) => Promise<PhaseResult>,
    previousNodeId: string | undefined,
  ): FlowNode<PipelineFlowContext> {
    const pid = executor.phaseId;
    const phaseDef = getPhase(pid)!;
    const maxGateRetries = this.deps.config.options.maxGateRetries ?? 1;

    return loop<PipelineFlowContext>({
      id: `phase-${pid}-with-gate`,
      dependsOn: previousNodeId ? [previousNodeId] : undefined,
      maxIterations: maxGateRetries + 1,
      while: async (flowCtx) => {
        // Gate already passed (previous iteration succeeded)
        if (flowCtx.context.gatesPassed[pid]) return false;

        // Checkpoint skip: phase already completed on a prior run
        if (this.deps.checkpoint.isPhaseCompleted(pid)) {
          // Executor may override to re-validate (e.g. IntegrationPhaseExecutor lints)
          if (executor.validatePriorCompletion) {
            const valid = await executor.validatePriorCompletion(ctx);
            if (!valid) return true; // re-execute
          }
          // Completed and valid — skip
          flowCtx.context.gatesPassed[pid] = true;
          return false;
        }

        return true;
      },
      do: [
        this.buildLoopExecuteStep(executor, phaseDef, executePhase),
        this.buildGateEvaluate(executor, gateCoordinator, maxGateRetries),
      ],
    });
  }

  /**
   * The execute step inside a gate-retry loop.
   */
  private buildLoopExecuteStep(
    executor: PhaseExecutor,
    phaseDef: PhaseDefinition,
    executePhase: (executor: PhaseExecutor) => Promise<PhaseResult>,
  ): FlowNode<PipelineFlowContext> {
    const pid = executor.phaseId;

    return step<PipelineFlowContext>({
      id: `phase-${pid}-execute`,
      run: async (flowCtx) => {
        const phaseResult = await executePhase(executor);
        const isRetry = (flowCtx.context.gateAttempts[pid] ?? 0) > 0;

        if (isRetry) {
          this.phases[this.phases.length - 1] = phaseResult;
        } else {
          this.phases.push(phaseResult);
        }

        if (!phaseResult.success) {
          if (isRetry) {
            await this.deps.progressWriter.appendEvent(
              `Pipeline aborted: phase ${pid} retry failed`,
            );
          }
          if (phaseDef.critical) {
            this.deps.logger.error(`Critical phase ${pid} failed, aborting pipeline`, {
              issueNumber: this.deps.issue.number,
              phase: pid,
            });
            await this.deps.progressWriter.appendEvent(
              `Pipeline aborted: phase ${pid} failed`,
            );
            throw new PipelineHaltError(
              phaseResult.error ?? `Phase ${pid} ${isRetry ? 'retry ' : ''}failed`,
              pid,
              executor.name,
            );
          }
          // Non-critical failure: mark gate as passed to exit loop
          flowCtx.context.gatesPassed[pid] = true;
          this.executedPhases.add(pid);
          return { phaseId: pid, success: false };
        }

        await this.deps.checkpoint.completePhase(pid, phaseResult.outputPath ?? '');
        this.executedPhases.add(pid);
        return { phaseId: pid, success: true };
      },
    });
  }

  /**
   * The gate evaluate step inside a gate-retry loop.
   */
  private buildGateEvaluate(
    executor: PhaseExecutor,
    gateCoordinator: GateCoordinator,
    maxGateRetries: number,
  ): FlowNode<PipelineFlowContext> {
    const pid = executor.phaseId;

    return gate<PipelineFlowContext>({
      id: `gate-${pid}`,
      evaluate: async (flowCtx) => {
        // If phase already marked as passed (non-critical fail), pass through
        if (flowCtx.context.gatesPassed[pid]) return true;

        const gateStatus = await gateCoordinator.runGate(pid, this.phases);
        if (gateStatus !== 'fail') {
          flowCtx.context.gatesPassed[pid] = true;
          return true;
        }

        // Gate failed — check if retries remain
        const attempt = (flowCtx.context.gateAttempts[pid] ?? 0) + 1;
        flowCtx.context.gateAttempts[pid] = attempt;

        if (attempt > maxGateRetries) {
          this.deps.logger.error(
            `Gate still failing for phase ${pid} after ${maxGateRetries} retries; aborting`,
            { issueNumber: this.deps.issue.number, phase: pid },
          );
          await this.deps.progressWriter.appendEvent(
            `Pipeline aborted: gate still failing for phase ${pid} after ${maxGateRetries} retries`,
          );
          throw new PipelineHaltError(
            `Gate validation failed for phase ${pid} after retry`,
            pid,
            executor.name,
          );
        }

        // Signal retry
        this.deps.logger.warn(
          `Gate failed for phase ${pid} (attempt ${attempt}/${maxGateRetries}); retrying`,
          { issueNumber: this.deps.issue.number, phase: pid },
        );
        await this.deps.progressWriter.appendEvent(
          `Phase ${pid} gate failed; retrying phase (attempt ${attempt}/${maxGateRetries})`,
        );
        return true;
      },
    });
  }

  /**
   * A plain execute step for phases without gates (phase 5).
   *
   * Folds checkpoint-skip detection: if the phase is completed, pushes a
   * skip result and returns immediately.
   */
  private buildExecuteStep(
    executor: PhaseExecutor,
    executePhase: (executor: PhaseExecutor) => Promise<PhaseResult>,
    previousNodeId: string | undefined,
  ): FlowNode<PipelineFlowContext> {
    const pid = executor.phaseId;
    const phaseDef = getPhase(pid)!;

    return step<PipelineFlowContext>({
      id: `phase-${pid}-execute`,
      dependsOn: previousNodeId ? [previousNodeId] : undefined,
      run: async (flowCtx) => {
        // Checkpoint skip
        if (this.deps.checkpoint.isPhaseCompleted(pid)) {
          flowCtx.context.gatesPassed[pid] = true;
          return { phaseId: pid, skipped: true };
        }

        const phaseResult = await executePhase(executor);
        this.phases.push(phaseResult);

        if (!phaseResult.success) {
          if (phaseDef.critical) {
            this.deps.logger.error(`Critical phase ${pid} failed, aborting pipeline`, {
              issueNumber: this.deps.issue.number,
              phase: pid,
            });
            await this.deps.progressWriter.appendEvent(
              `Pipeline aborted: phase ${pid} failed`,
            );
            throw new PipelineHaltError(
              phaseResult.error ?? `Phase ${pid} failed`,
              pid,
              executor.name,
            );
          }
          this.executedPhases.add(pid);
          return { phaseId: pid, success: false };
        }

        await this.deps.checkpoint.completePhase(pid, phaseResult.outputPath ?? '');
        this.executedPhases.add(pid);
        return { phaseId: pid, success: true };
      },
    });
  }

  /**
   * Ambiguity gate after phase 1: reads ambiguities and halts if threshold exceeded.
   */
  private buildAmbiguityGate(
    executor: PhaseExecutor,
    gateCoordinator: GateCoordinator,
    previousNodeId: string,
  ): FlowNode<PipelineFlowContext> {
    const pid = executor.phaseId;

    return gate<PipelineFlowContext>({
      id: `phase-${pid}-ambiguity-gate`,
      dependsOn: [previousNodeId],
      evaluate: async () => {
        const ambiguities = await gateCoordinator.readAmbiguities();
        for (const ambiguity of ambiguities) {
          this.deps.logger.warn(`Ambiguity in issue #${this.deps.issue.number}: ${ambiguity}`, {
            issueNumber: this.deps.issue.number,
          });
        }
        if (ambiguities.length > 0) {
          await this.deps.notificationManager.dispatch({
            type: 'ambiguity-detected',
            issueNumber: this.deps.issue.number,
            ambiguities,
          });
        }
        if (
          this.deps.config.options.haltOnAmbiguity
          && ambiguities.length > this.deps.config.options.ambiguityThreshold
        ) {
          const msg = `Analysis identified ${ambiguities.length} ambiguities (threshold: ${this.deps.config.options.ambiguityThreshold})`;
          await this.deps.progressWriter.appendEvent(`Pipeline halted: ${msg}`);
          throw new PipelineHaltError(msg, pid, executor.name);
        }
        return true;
      },
    });
  }

  /**
   * Post-phase hooks: strip cadre files, commit-per-phase, agent resync.
   *
   * Also handles pushing the skip PhaseResult when a phase was checkpoint-skipped
   * (loop ran 0 iterations).
   */
  private buildPostHooks(
    executor: PhaseExecutor,
    previousNodeId: string,
  ): FlowNode<PipelineFlowContext> {
    const pid = executor.phaseId;
    const phaseDef = getPhase(pid)!;

    return step<PipelineFlowContext>({
      id: `phase-${pid}-post-hooks`,
      dependsOn: [previousNodeId],
      run: async (flowCtx) => {
        // Phase was checkpoint-skipped — push skip result, no hooks needed
        if (!this.executedPhases.has(pid)) {
          this.deps.logger.info(`Skipping completed phase ${pid}: ${executor.name}`, {
            issueNumber: this.deps.issue.number,
            phase: pid,
          });
          this.phases.push({
            phase: pid,
            phaseName: executor.name,
            success: true,
            duration: 0,
            tokenUsage: 0,
          });
          this.skippedPhases.add(pid);
          return { hooked: false };
        }

        if (pid === 4) {
          await this.deps.commitManager.stripCadreFiles(this.deps.worktree.baseCommit);
        }

        if (this.deps.config.commits.commitPerPhase) {
          await this.commitPhase(phaseDef);
        }

        // Re-sync agent symlinks AFTER the Phase 4 commit so they don't
        // leak into git history.
        if (pid === 4 && this.deps.resyncAgentFiles) {
          await this.deps.resyncAgentFiles();
        }

        return { hooked: true };
      },
    });
  }

  /**
   * Lifecycle notification + progress update after a phase.
   */
  private buildNotify(
    executor: PhaseExecutor,
    lifecycleNotifier: IssueLifecycleNotifier,
    previousNodeId: string,
  ): FlowNode<PipelineFlowContext> {
    const pid = executor.phaseId;

    return step<PipelineFlowContext>({
      id: `phase-${pid}-notify`,
      dependsOn: [previousNodeId],
      run: async (flowCtx) => {
        // Skip notification for checkpoint-skipped phases
        if (this.skippedPhases.has(pid)) {
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
    });
  }

  // ── Helpers ──

  private async commitPhase(phase: PhaseDefinition): Promise<void> {
    try {
      const isClean = await this.deps.commitManager.isClean();
      if (!isClean) {
        const type = phase.commitType ?? 'chore';
        const message = (phase.commitMessage ?? `phase ${phase.id} complete`)
          .replace('{issueNumber}', String(this.deps.issue.number));

        await this.deps.commitManager.commit(message, this.deps.issue.number, type);
      }
    } catch (err) {
      this.deps.logger.warn(`Failed to commit after phase ${phase.id}: ${err}`, {
        issueNumber: this.deps.issue.number,
      });
    }
  }

  private async updateProgress(): Promise<void> {
    const cpState = this.deps.checkpoint.getState();
    const taskStatuses: Array<{ id: string; name: string; status: string }> = cpState.completedTasks.map((id) => ({
      id,
      name: id,
      status: 'completed',
    }));

    for (const id of cpState.blockedTasks) {
      taskStatuses.push({ id, name: id, status: 'blocked' });
    }

    await this.deps.progressWriter.write(
      this.phases,
      cpState.currentPhase,
      taskStatuses,
      this.deps.getTokenUsage() ?? 0,
    );
  }
}
