/**
 * Pure callback factories for flow DSL nodes in the per-issue pipeline.
 *
 * Each function returns the callback for a single DSL node — small, focused,
 * and independently testable.  No shared mutable state; the orchestrator
 * passes deps and reads results from `FlowRunResult.outputs`.
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
import type { FlowExecutionContext } from '@cadre-dev/framework/flow';
import { getPhase } from './phase-registry.js';

/**
 * Pipeline-level flow context shared across all DSL nodes.
 * Kept minimal: only gate retry tracking.
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
  resyncAgentFiles?: () => Promise<void>;
  /**
   * Running phases list.  Gate coordinator requires mutable access to record
   * gate results on the most recent entry.  Post-run, the orchestrator reads
   * final results from FlowRunResult.outputs instead.
   */
  phases: PhaseResult[];
}

type Ctx = FlowExecutionContext<PipelineFlowContext>;

/** Typed record of all callback factories used by DSL nodes. */
export interface PhaseActions {
  /** `while` guard for the gate-retry loop (also handles checkpoint skip). */
  shouldExecute: (executor: PhaseExecutor, phaseCtx: PhaseContext) =>
    (ctx: Ctx) => Promise<boolean>;
  /** Execute a phase inside the gate-retry loop. */
  execute: (executor: PhaseExecutor, executePhase: (e: PhaseExecutor) => Promise<PhaseResult>) =>
    (ctx: Ctx) => Promise<PhaseResult>;
  /** Gate evaluation inside the gate-retry loop. */
  evaluateGate: (executor: PhaseExecutor, gateCoordinator: GateCoordinator) =>
    (ctx: Ctx) => Promise<boolean>;
  /** `onSkip` handler for when a loop runs 0 iterations (checkpoint skip). */
  onPhaseSkip: (executor: PhaseExecutor) =>
    (ctx: Ctx) => Promise<{ skipped: true; phaseId: number }>;
  /** Execute a gate-less phase (phase 5). */
  executeUngated: (executor: PhaseExecutor, phaseCtx: PhaseContext, executePhase: (e: PhaseExecutor) => Promise<PhaseResult>) =>
    (ctx: Ctx) => Promise<PhaseResult>;
  /** Ambiguity check after phase 1. */
  checkAmbiguities: (gateCoordinator: GateCoordinator) =>
    (ctx: Ctx) => Promise<boolean>;
  /** Post-phase hooks: strip cadre files, commit, resync. */
  finalize: (executor: PhaseExecutor) =>
    (ctx: Ctx) => Promise<{ finalized: boolean }>;
}

/**
 * Create all callback factories for pipeline DSL nodes.
 */
export function createPhaseActions(deps: PhaseActionDeps): PhaseActions {
  return {
    shouldExecute: (executor, phaseCtx) => async (ctx) => {
      const pid = executor.phaseId;
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

    execute: (executor, executePhase) => async (ctx) => {
      const pid = executor.phaseId;
      const phaseDef = getPhase(pid)!;
      const isRetry = (ctx.context.gateAttempts[pid] ?? 0) > 0;
      const phaseResult = await executePhase(executor);

      // Maintain running phases list for gate coordinator
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
        if (phaseDef.critical) {
          deps.logger.error(`Critical phase ${pid} failed, aborting pipeline`, {
            issueNumber: deps.issue.number, phase: pid,
          });
          await deps.progressWriter.appendEvent(`Pipeline aborted: phase ${pid} failed`);
          throw new PipelineHaltError(
            phaseResult.error ?? `Phase ${pid} ${isRetry ? 'retry ' : ''}failed`,
            pid, executor.name,
          );
        }
        ctx.context.gatesPassed[pid] = true;
      } else {
        await deps.checkpoint.completePhase(pid, phaseResult.outputPath ?? '');
      }

      return phaseResult;
    },

    evaluateGate: (executor, gateCoordinator) => async (ctx) => {
      const pid = executor.phaseId;
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

    onPhaseSkip: (executor) => async (_ctx) => {
      const pid = executor.phaseId;
      deps.logger.info(`Skipping completed phase ${pid}: ${executor.name}`, {
        issueNumber: deps.issue.number, phase: pid,
      });
      deps.phases.push({
        phase: pid,
        phaseName: executor.name,
        success: true,
        duration: 0,
        tokenUsage: 0,
        skipped: true,
      } as PhaseResult & { skipped?: boolean });
      return { skipped: true, phaseId: pid };
    },

    executeUngated: (executor, phaseCtx, executePhase) => async (ctx) => {
      const pid = executor.phaseId;
      const phaseDef = getPhase(pid)!;

      // Checkpoint skip
      if (deps.checkpoint.isPhaseCompleted(pid)) {
        const shouldRerun = executor.validatePriorCompletion
          ? !(await executor.validatePriorCompletion(phaseCtx))
          : false;

        if (!shouldRerun) {
          deps.logger.info(`Skipping completed phase ${pid}: ${executor.name}`, {
            issueNumber: deps.issue.number, phase: pid,
          });
          const skipResult: PhaseResult = {
            phase: pid,
            phaseName: executor.name,
            success: true,
            duration: 0,
            tokenUsage: 0,
          };
          (skipResult as PhaseResult & { skipped?: boolean }).skipped = true;
          deps.phases.push(skipResult);
          return skipResult;
        }
      }

      const phaseResult = await executePhase(executor);
      deps.phases.push(phaseResult);
      if (!phaseResult.success && phaseDef.critical) {
        deps.logger.error(`Critical phase ${pid} failed, aborting pipeline`, {
          issueNumber: deps.issue.number, phase: pid,
        });
        await deps.progressWriter.appendEvent(`Pipeline aborted: phase ${pid} failed`);
        throw new PipelineHaltError(
          phaseResult.error ?? `Phase ${pid} failed`,
          pid, executor.name,
        );
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
      const pid = executor.phaseId;
      const phaseDef = getPhase(pid)!;

      // Skip hooks for checkpoint-skipped phases
      const lastPhase = deps.phases[deps.phases.length - 1] as PhaseResult & { skipped?: boolean };
      if (lastPhase?.skipped) {
        return { finalized: false };
      }

      if (pid === 4) {
        await deps.commitManager.stripCadreFiles(deps.worktree.baseCommit);
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

      if (pid === 4 && deps.resyncAgentFiles) {
        await deps.resyncAgentFiles();
      }

      return { finalized: true };
    },
  };
}
