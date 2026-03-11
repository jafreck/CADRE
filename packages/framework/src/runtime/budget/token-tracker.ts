/**
 * Tracks token usage across all issues, agents, and phases.
 */
export class TokenTracker {
  private records: TokenRecord[] = [];

  /**
   * Record usage for an agent + phase, optionally scoped to a work item.
   */
  record(workItemId: string | undefined, agent: string, phase: number, tokens: number, input?: number, output?: number): void {
    this.records.push({
      workItemId,
      agent,
      phase,
      tokens,
      timestamp: new Date().toISOString(),
      input,
      output,
    });
  }

  /**
   * Get total usage across all issues.
   */
  getTotal(): number {
    return this.records.reduce((sum, r) => sum + r.tokens, 0);
  }

  /**
   * Get usage for a specific work item.
   */
  getWorkItemTotal(workItemId: string): number {
    return this.records
      .filter((r) => r.workItemId === workItemId)
      .reduce((sum, r) => sum + r.tokens, 0);
  }

  /**
   * Get usage broken down by agent.
   */
  getByAgent(): Record<string, number> {
    const byAgent: Record<string, number> = {};
    for (const r of this.records) {
      byAgent[r.agent] = (byAgent[r.agent] ?? 0) + r.tokens;
    }
    return byAgent;
  }

  /**
   * Get usage broken down by work item.
   */
  getByWorkItem(): Record<string, number> {
    const byWorkItem: Record<string, number> = {};
    for (const r of this.records) {
      if (r.workItemId != null) {
        byWorkItem[r.workItemId] = (byWorkItem[r.workItemId] ?? 0) + r.tokens;
      }
    }
    return byWorkItem;
  }

  /**
   * Get usage broken down by phase.
   */
  getByPhase(): Record<number, number> {
    const byPhase: Record<number, number> = {};
    for (const r of this.records) {
      byPhase[r.phase] = (byPhase[r.phase] ?? 0) + r.tokens;
    }
    return byPhase;
  }

  /**
   * Check fleet-wide budget threshold.
   */
  checkFleetBudget(budget?: number): 'ok' | 'warning' | 'exceeded' {
    if (!budget) return 'ok';
    const total = this.getTotal();
    if (total >= budget) return 'exceeded';
    if (total >= budget * 0.8) return 'warning';
    return 'ok';
  }

  /**
   * Check per-work-item budget threshold.
   */
  checkWorkItemBudget(workItemId: string, budget?: number): 'ok' | 'warning' | 'exceeded' {
    if (!budget) return 'ok';
    const total = this.getWorkItemTotal(workItemId);
    if (total >= budget) return 'exceeded';
    if (total >= budget * 0.8) return 'warning';
    return 'ok';
  }

  /**
   * Get a summary of token usage.
   */
  getSummary(): TokenSummary {
    return {
      total: this.getTotal(),
      byWorkItem: this.getByWorkItem(),
      byAgent: this.getByAgent(),
      byPhase: this.getByPhase(),
      recordCount: this.records.length,
    };
  }

  /**
   * Export all records (for checkpoint persistence).
   */
  exportRecords(): TokenRecord[] {
    return [...this.records];
  }

  /**
   * Import records (for checkpoint resume).
   */
  importRecords(records: TokenRecord[]): void {
    this.records = [...records];
  }
}

export interface TokenRecord {
  workItemId?: string;
  agent: string;
  phase: number;
  tokens: number;
  timestamp: string;
  input?: number;
  output?: number;
}

export interface TokenSummary {
  total: number;
  byWorkItem: Record<string, number>;
  byAgent: Record<string, number>;
  byPhase: Record<number, number>;
  recordCount: number;
}
