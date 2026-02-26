import type { TokenUsageDetail } from '../agents/types.js';
import type { CheckpointManager } from './checkpoint.js';
import type { NotificationManager } from '../notifications/manager.js';
import type { TokenTracker } from '../budget/token-tracker.js';

export class BudgetExceededError extends Error {
  constructor() {
    super('Per-issue token budget exceeded');
    this.name = 'BudgetExceededError';
  }
}

/**
 * Tracks per-issue token usage, detects budget-exceeded/warning transitions,
 * and dispatches budget-warning notifications exactly once.
 */
export class IssueBudgetGuard {
  private _budgetExceeded = false;
  private budgetWarningSent = false;

  constructor(
    private readonly tokenTracker: TokenTracker,
    private readonly notificationManager: NotificationManager,
    private readonly checkpoint: CheckpointManager,
    private readonly issueNumber: number,
    private readonly tokenBudget?: number,
  ) {}

  get budgetExceeded(): boolean {
    return this._budgetExceeded;
  }

  recordTokens(agent: string, tokens: TokenUsageDetail | number | null): void {
    const isDetail = typeof tokens === 'object' && tokens !== null;
    const tokenCount = isDetail ? tokens.input + tokens.output : tokens;

    if (tokenCount != null && tokenCount > 0) {
      this.tokenTracker.record(
        this.issueNumber,
        agent,
        this.checkpoint.getState().currentPhase,
        tokenCount,
        isDetail ? tokens.input : undefined,
        isDetail ? tokens.output : undefined,
      );
      void this.checkpoint.recordTokenUsage(
        agent,
        this.checkpoint.getState().currentPhase,
        tokenCount,
      );
    }

    if (
      !this._budgetExceeded &&
      this.tokenTracker.checkIssueBudget(this.issueNumber, this.tokenBudget) === 'exceeded'
    ) {
      this._budgetExceeded = true;
    }

    if (
      !this.budgetWarningSent &&
      !this._budgetExceeded &&
      this.tokenTracker.checkIssueBudget(this.issueNumber, this.tokenBudget) === 'warning'
    ) {
      this.budgetWarningSent = true;
      const currentUsage = this.tokenTracker.getTotal() ?? 0;
      const budget = this.tokenBudget ?? 0;
      void this.notificationManager.dispatch({
        type: 'budget-warning',
        scope: 'issue',
        issueNumber: this.issueNumber,
        currentUsage,
        budget,
        percentUsed: budget > 0 ? Math.round((currentUsage / budget) * 100) : 0,
      });
    }
  }

  checkBudget(): void {
    if (this._budgetExceeded) throw new BudgetExceededError();
  }
}
