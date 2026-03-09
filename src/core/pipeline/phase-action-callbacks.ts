/**
 * Callback factories for flow DSL nodes in the per-issue pipeline.
 *
 * Four factory methods return callbacks for DSL nodes:
 *
 *  - `gated(executor, gateCoordinator)` → spreadable into `gatedStep()`
 *  - `ungated(executor)` → run callback for `step()`
 *  - `finalize(executor)` → post-phase commit & cleanup step
 *  - `checkAmbiguities(gateCoordinator)` → ambiguity gate for phase 1
 *
 * The orchestrator passes deps at construction; the factories capture them
 * via closure so the DSL topology stays declarative and free of plumbing.
 */

import type { PhaseResult } from '../../agents/types.js';
import type { RuntimeConfig } from '../../config/loader.js';
import type { IssueDetail } from '../../platform/provider.js';
import type { WorktreeInfo } from '../../git/worktree.js';
import type { CheckpointManager, IssueProgressWriter } from '@cadre-dev/framework/engine';
import type { Logger } from '@cadre-dev/framework/core';
import type { NotificationManager } from '@cadre-dev/framework/notifications';
import type { CommitManager } from '../../git/commit.js';
import type { PhaseExecutor, PhaseContext } from './phase-executor.js';
import type { GateCoordinator } from './gate-coordinator.js';
import type { FlowExecutionContext, MaybePromise } from '@cadre-dev/framework/flow';
import { getPhase } from './phase-registry.js';

/**
 * Pipeline-level flow context shared across all DSL nodes.
 * Tracks gate completion and retry counts per phase.
 */
export interface PipelineFlowContext {
  gatesPassed: Record<number, boolean>;
  gateAttempts: Record<number, number>;
}

export class PipelineHaltError extends Error {
  constructor(
    message: string,
    readonly phaseId?: number,
    readonly phaseName?: string,
  ) {
    super(message);
    this.name = 'PipelineHaltError';
  }
}

/** Per-phase lifecycle hooks invoked during finalize. */
export interface PhaseHooks {
  /** Called before the per-phase commit (e.g. strip intermediate files). */
  beforeCommit?: () => Promise<void>;
  /** Called after finalize completes successfully (e.g. resync files). */
  afterFinalize?: () => Promise<void>;
}

/** Dependencies for phase action callbacks. */
export interface PhaseActionDeps {
  config: RuntimeConfig;
  issue: IssueDetail;
  worktree: WorktreeInfo;
  checkpoint: CheckpointManager;
  logger: Logger;
  progressWriter: IssueProgressWriter;
  notificationManager: NotificationManager;
  commitManager: CommitManager;
  /**
   * Running phases list — gate coordinator mutates the last entry to record
   * gate results.  The orchestrator reads final results post-run.
   */
  phases: PhaseResult[];
  /**
   * Optional per-phase lifecycle hooks, keyed by phase ID.
   * Called during finalize to run phase-specific pre-commit or post-finalize
   * work without hardcoding phase IDs in the generic callback logic.
   */
  phaseHooks?: Record<number, PhaseHooks>;
}

type Ctx = FlowExecutionContext<PipelineFlowContext>;

/** Callbacks returned by `gated()` — spread directly into `gatedStep()`. */
export interface GatedPhaseCallbacks {
  shouldExecute: (ctx: Ctx) => MaybePromise<boolean>;
  onSkip: (ctx: Ctx) => MaybePromise<unknown>;
  run: (ctx: Ctx) => MaybePromise<unknown>;
  evaluate: (ctx: Ctx) => MaybePromise<boolean>;
}

/** Factory methods for phase DSL node callbacks. */
export interface PhaseActions {
  /** Build `gatedStep` callbacks for a gated phase — spread into config. */
  gated: (
    executor: PhaseExecutor,
    phaseCtx: PhaseContext,
    gateCoordinator: GateCoordinator,
    executePhase: (e: PhaseExecutor) => Promise<PhaseResult>,
  ) => GatedPhaseCallbacks;
  /** Build a `step.run` callback for an ungated phase (e.g. PR composition). */
  ungated: (
    executor: PhaseExecutor,
    phaseCtx: PhaseContext,
    executePhase: (e: PhaseExecutor) => Promise<PhaseResult>,
  ) => (ctx: Ctx) => Promise<PhaseResult>;
  /** Post-phase commit & cleanup step. */
  finalize: (executor: PhaseExecutor) =>
    (ctx: Ctx) => Promise<{ finalized: boolean }>;
  /** Ambiguity check gate after phase 1. */
  checkAmbiguities: (gateCoordinator: GateCoordinator) =>
    (ctx: Ctx) => Promise<boolean>;
}

/**
 * Create all callback factories for pipeline DSL nodes.
 */
export function createPhaseActions(deps: PhaseActionDeps): PhaseActions {
  // ── helpers ─────────────────────────────────────────────────────────

  function skipResult(executor: PhaseExecutor): PhaseResult & { skipped: boolean } {
    return {
      phase: executor.id,
      phaseName: executor.name,
      success: true,
      duration: 0,
      tokenUsage: 0,
      skipped: true,
    } as PhaseResult & { skipped: boolean };
  }

  function handleFailure(pid: number, executor: PhaseExecutor, result: PhaseResult, isRetry: boolean): void | never {
    const phaseDef = getPhase(pid)!;
    if (phaseDef.critical) {
      deps.logger.error(`Critical phase ${pid} failed, aborting pipeline`, {
        issueNumber: deps.issue.number, phase: pid,
      });
      throw new PipelineHaltError(
        result.error ?? `Phase ${pid} ${isRetry ? 'retry ' : ''}failed`,
        pid, executor.name,
      );
    }
  }

  // ── factories ───────────────────────────────────────────────────────

  return {
    gated: (executor, phaseCtx, gateCoordinator, executePhase) => ({
      shouldExecute: async (ctx) => {
        const pid = executor.id;
        if (ctx.context.gatesPassed[pid]) return false;

        if (deps.checkpoint.isPhaseCompleted(pid)) {
          if (executor.validatePriorCompletion) {
            const valid = await executor.validatePriorCompletion(phaseCtx);
            if (!valid) return true;
          }
          ctx.context.gatesPassed[pid] = true;
          return false;
        }

        return true;
      },

      onSkip: async (_ctx) => {
        const pid = executor.id;
        deps.logger.info(`Skipping completed phase ${pid}: ${executor.name}`, {
          issueNumber: deps.issue.number, phase: pid,
        });
        deps.phases.push(skipResult(executor));
        return { skipped: true, phaseId: pid };
      },

      run: async (ctx) => {
        const pid = executor.id;
        const isRetry = (ctx.context.gateAttempts[pid] ?? 0) > 0;
        const phaseResult = await executePhase(executor);

        if (isRetry) {
          deps.phases[deps.phases.length - 1] = phaseResult;
        } else {
          deps.phases.push(phaseResult);
        }

        if (!phaseResult.success) {
          if (isRetry) {
            await deps.progressWriter.appendEvent(
              `Pipeline aborted: phase ${pid} retry failed`,
            );
          }
          handleFailure(pid, executor, phaseResult, isRetry);
          ctx.context.gatesPassed[pid] = true;
        } else {
          await deps.checkpoint.completePhase(pid, phaseResult.outputPath ?? '');
        }

        return phaseResult;
      },

      evaluate: async (ctx) => {
        const pid = executor.id;
        if (ctx.context.gatesPassed[pid]) return true;

        const maxGateRetries = deps.config.options.maxGateRetries ?? 1;
        const gateStatus = await gateCoordinator.runGate(pid, deps.phases);
        if (gateStatus !== 'fail') {
          ctx.context.gatesPassed[pid] = true;
          return true;
        }

        const attempt = (ctx.context.gateAttempts[pid] ?? 0) + 1;
        ctx.context.gateAttempts[pid] = attempt;

        if (attempt > maxGateRetries) {
          deps.logger.error(
            `Gate still failing for phase ${pid} after ${maxGateRetries} retries; aborting`,
            { issueNumber: deps.issue.number, phase: pid },
          );
          await deps.progressWriter.appendEvent(
            `Pipeline aborted: gate still failing for phase ${pid} after ${maxGateRetries} retries`,
          );
          throw new PipelineHaltError(
            `Gate validation failed for phase ${pid} after retry`,
            pid, executor.name,
          );
        }

        deps.logger.warn(
          `Gate failed for phase ${pid} (attempt ${attempt}/${maxGateRetries}); retrying`,
          { issueNumber: deps.issue.number, phase: pid },
        );
        await deps.progressWriter.appendEvent(
          `Phase ${pid} gate failed; retrying phase (attempt ${attempt}/${maxGateRetries})`,
        );
        return true;
      },
    }),

    ungated: (executor, phaseCtx, executePhase) => async (_ctx) => {
      const pid = executor.id;

      // Checkpoint skip
      if (deps.checkpoint.isPhaseCompleted(pid)) {
        const shouldRerun = executor.validatePriorCompletion
          ? !(await executor.validatePriorCompletion(phaseCtx))
          : false;

        if (!shouldRerun) {
          deps.logger.info(`Skipping completed phase ${pid}: ${executor.name}`, {
            issueNumber: deps.issue.number, phase: pid,
          });
          deps.phases.push(skipResult(executor));
          return skipResult(executor);
        }
      }

      const phaseResult = await executePhase(executor);
      deps.phases.push(phaseResult);
      if (!phaseResult.success) {
        handleFailure(pid, executor, phaseResult, false);
      }
      if (phaseResult.success) {
        await deps.checkpoint.completePhase(pid, phaseResult.outputPath ?? '');
      }
      return phaseResult;
    },

    checkAmbiguities: (gateCoordinator) => async (_ctx) => {
      const ambiguities = await gateCoordinator.readAmbiguities();
      for (const ambiguity of ambiguities) {
        deps.logger.warn(`Ambiguity in issue #${deps.issue.number}: ${ambiguity}`, {
          issueNumber: deps.issue.number,
        });
      }
      if (ambiguities.length > 0) {
        await deps.notificationManager.dispatch({
          type: 'ambiguity-detected',
          issueNumber: deps.issue.number,
          ambiguities,
        });
      }
      if (
        deps.config.options.haltOnAmbiguity
        && ambiguities.length > deps.config.options.ambiguityThreshold
      ) {
        const msg = `Analysis identified ${ambiguities.length} ambiguities (threshold: ${deps.config.options.ambiguityThreshold})`;
        await deps.progressWriter.appendEvent(`Pipeline halted: ${msg}`);
        throw new PipelineHaltError(msg, 1, 'Analysis & Scouting');
      }
      return true;
    },

    finalize: (executor) => async (_ctx) => {
      const pid = executor.id;
      const phaseDef = getPhase(pid)!;

      // Skip hooks for checkpoint-skipped phases
      const lastPhase = deps.phases[deps.phases.length - 1] as PhaseResult & { skipped?: boolean };
      if (lastPhase?.skipped) {
        return { finalized: false };
      }

      const hooks = deps.phaseHooks?.[pid];

      if (hooks?.beforeCommit) {
        await hooks.beforeCommit();
      }

      if (deps.config.commits.commitPerPhase) {
        try {
          const isClean = await deps.commitManager.isClean();
          if (!isClean) {
            const type = phaseDef.commitType ?? 'chore';
            const message = (phaseDef.commitMessage ?? `phase ${phaseDef.id} complete`)
              .replace('{issueNumber}', String(deps.issue.number));
            await deps.commitManager.commit(message, deps.issue.number, type);
          }
        } catch (err) {
          deps.logger.warn(`Failed to commit after phase ${pid}: ${err}`, {
            issueNumber: deps.issue.number,
          });
        }
      }

      if (hooks?.afterFinalize) {
        await hooks.afterFinalize();
      }

      return { finalized: true };
    },
  };
}
