import type { PhaseResult } from '../../agents/types.js';
import type { PhaseExecutor, PhaseContext } from './phase-executor.js';
import type { CheckpointManager, IssueProgressWriter } from '@cadre-dev/framework/engine';
import type { TokenTracker } from '@cadre-dev/framework/runtime';
import type { Logger } from '@cadre-dev/framework/core';
import type { GateCoordinator } from './gate-coordinator.js';
import { BudgetExceededError } from '../issue/issue-budget-guard.js';

/**
 * Encapsulates single-phase execution and the gate-retry loop.
 *
 * Flow: execute → runGate → optional single retry → re-check gate → abort on second failure.
 */
export class PhaseRunner {
  constructor(
    private readonly gateCoordinator: GateCoordinator,
    private readonly checkpoint: CheckpointManager,
    private readonly progressWriter: IssueProgressWriter,
    private readonly tokenTracker: TokenTracker,
    private readonly logger: Logger,
    private readonly issueNumber: number,
  ) {}

  /**
   * Execute a phase, run its gate, and retry once on gate failure.
   * Returns a PhaseResult. BudgetExceededError is propagated without wrapping.
   */
  async runPhase(executor: PhaseExecutor, ctx: PhaseContext, phases: PhaseResult[]): Promise<PhaseResult> {
    let phaseResult = await this.executePhase(executor, ctx);
    phases.push(phaseResult);

    if (!phaseResult.success) {
      return phaseResult;
    }

    await this.checkpoint.completePhase(executor.id, phaseResult.outputPath ?? '');

    // Run gate validators after phases 1–4
    if (executor.id >= 1 && executor.id <= 4) {
      const gateStatus = await this.gateCoordinator.runGate(executor.id, phases);
      if (gateStatus === 'fail') {
        this.logger.warn(`Gate failed for phase ${executor.id}; retrying`, {
          issueNumber: this.issueNumber,
          phase: executor.id,
        });
        await this.progressWriter.appendEvent(`Phase ${executor.id} gate failed; retrying phase`);

        const retryResult = await this.executePhase(executor, ctx);
        phases[phases.length - 1] = retryResult;

        if (!retryResult.success) {
          await this.progressWriter.appendEvent(`Pipeline aborted: phase ${executor.id} retry failed`);
          return retryResult;
        }

        await this.checkpoint.completePhase(executor.id, retryResult.outputPath ?? '');
        const retryGateStatus = await this.gateCoordinator.runGate(executor.id, phases);
        if (retryGateStatus === 'fail') {
          this.logger.error(`Gate still failing for phase ${executor.id} after retry; aborting`, {
            issueNumber: this.issueNumber,
            phase: executor.id,
          });
          await this.progressWriter.appendEvent(
            `Pipeline aborted: gate still failing for phase ${executor.id} after retry`,
          );
          return {
            ...retryResult,
            success: false,
            error: `Gate validation failed for phase ${executor.id} after retry`,
          };
        }

        return retryResult;
      }
    }

    return phaseResult;
  }

  /**
   * Execute a single phase. BudgetExceededError propagates without wrapping.
   */
  private async executePhase(executor: PhaseExecutor, ctx: PhaseContext): Promise<PhaseResult> {
    const phaseStart = Date.now();
    await this.checkpoint.startPhase(executor.id);
    await this.progressWriter.appendEvent(`Phase ${executor.id} started: ${executor.name}`);

    this.logger.info(`Phase ${executor.id}: ${executor.name}`, {
      issueNumber: this.issueNumber,
      phase: executor.id,
    });

    try {
      const outputPath = await executor.execute(ctx);

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
}
