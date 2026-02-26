import type { PhaseResult } from '../agents/types.js';
import type { PhaseExecutor, PhaseContext } from './phase-executor.js';
import type { CheckpointManager } from './checkpoint.js';
import type { IssueProgressWriter } from './progress.js';
import type { TokenTracker } from '../budget/token-tracker.js';
import type { Logger } from '../logging/logger.js';
import type { GateCoordinator } from './gate-coordinator.js';
import { BudgetExceededError } from './issue-budget-guard.js';

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

    await this.checkpoint.completePhase(executor.phaseId, phaseResult.outputPath ?? '');

    // Run gate validators after phases 1–4
    if (executor.phaseId >= 1 && executor.phaseId <= 4) {
      const gateStatus = await this.gateCoordinator.runGate(executor.phaseId, phases);
      if (gateStatus === 'fail') {
        this.logger.warn(`Gate failed for phase ${executor.phaseId}; retrying`, {
          issueNumber: this.issueNumber,
          phase: executor.phaseId,
        });
        await this.progressWriter.appendEvent(`Phase ${executor.phaseId} gate failed; retrying phase`);

        const retryResult = await this.executePhase(executor, ctx);
        phases[phases.length - 1] = retryResult;

        if (!retryResult.success) {
          await this.progressWriter.appendEvent(`Pipeline aborted: phase ${executor.phaseId} retry failed`);
          return retryResult;
        }

        await this.checkpoint.completePhase(executor.phaseId, retryResult.outputPath ?? '');
        const retryGateStatus = await this.gateCoordinator.runGate(executor.phaseId, phases);
        if (retryGateStatus === 'fail') {
          this.logger.error(`Gate still failing for phase ${executor.phaseId} after retry; aborting`, {
            issueNumber: this.issueNumber,
            phase: executor.phaseId,
          });
          await this.progressWriter.appendEvent(
            `Pipeline aborted: gate still failing for phase ${executor.phaseId} after retry`,
          );
          return {
            ...retryResult,
            success: false,
            error: `Gate validation failed for phase ${executor.phaseId} after retry`,
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
    await this.checkpoint.startPhase(executor.phaseId);
    await this.progressWriter.appendEvent(`Phase ${executor.phaseId} started: ${executor.name}`);

    this.logger.info(`Phase ${executor.phaseId}: ${executor.name}`, {
      issueNumber: this.issueNumber,
      phase: executor.phaseId,
    });

    try {
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
}
