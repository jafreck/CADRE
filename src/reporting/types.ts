export interface RunIssueSummary {
  issueNumber: number;
  issueTitle: string;
  success: boolean;
  prNumber?: number;
  tokens: number;
  duration: number;
  error?: string;
}

export interface RunPhaseSummary {
  id: string;
  name: string;
  duration: number;
  tokens: number;
  estimatedCost: number;
}

export interface RunTotals {
  tokens: number;
  estimatedCost: number;
  issues: number;
  prsCreated: number;
  failures: number;
}

export interface RunReport {
  runId: string;
  project: string;
  startTime: string;
  endTime: string;
  duration: number;
  issues: RunIssueSummary[];
  phases: RunPhaseSummary[];
  totalTokens: number;
  estimatedCost: number;
  prsCreated: number;
  agentInvocations: number;
  retries: number;
  totals: RunTotals;
}
