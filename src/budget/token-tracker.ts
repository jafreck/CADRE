/**
 * Tracks token usage across all issues, agents, and phases.
 */
export class TokenTracker {
  private records: TokenRecord[] = [];

  /**
   * Record usage for a specific issue + agent + phase.
   */
  record(issueNumber: number, agent: string, phase: number, tokens: number): void {
    this.records.push({
      issueNumber,
      agent,
      phase,
      tokens,
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * Record detailed token usage with input/output breakdown.
   */
  recordDetailed(issueNumber: number, agent: string, phase: number, detail: TokenUsageDetail): void {
    this.records.push({
      issueNumber,
      agent,
      phase,
      tokens: detail.input + detail.output,
      input: detail.input,
      output: detail.output,
      timestamp: new Date().toISOString(),
    });
  }

  /**
   * Get total usage across all issues.
   */
  getTotal(): number {
    return this.records.reduce((sum, r) => sum + r.tokens, 0);
  }

  /**
   * Get usage for a specific issue.
   */
  getIssueTotal(issueNumber: number): number {
    return this.records
      .filter((r) => r.issueNumber === issueNumber)
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
   * Get usage broken down by issue.
   */
  getByIssue(): Record<number, number> {
    const byIssue: Record<number, number> = {};
    for (const r of this.records) {
      byIssue[r.issueNumber] = (byIssue[r.issueNumber] ?? 0) + r.tokens;
    }
    return byIssue;
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
   * Check per-issue budget threshold.
   */
  checkIssueBudget(issueNumber: number, budget?: number): 'ok' | 'warning' | 'exceeded' {
    if (!budget) return 'ok';
    const total = this.getIssueTotal(issueNumber);
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
      byIssue: this.getByIssue(),
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
   * Get all records (alias for exportRecords).
   */
  getRecords(): TokenRecord[] {
    return this.exportRecords();
  }

  /**
   * Import records (for checkpoint resume).
   */
  importRecords(records: TokenRecord[]): void {
    this.records = [...records];
  }
}

export interface TokenUsageDetail {
  input: number;
  output: number;
}

export interface TokenRecord {
  issueNumber: number;
  agent: string;
  phase: number;
  tokens: number;
  timestamp: string;
  input?: number;
  output?: number;
}

export interface TokenSummary {
  total: number;
  byIssue: Record<number, number>;
  byAgent: Record<string, number>;
  byPhase: Record<number, number>;
  recordCount: number;
}
