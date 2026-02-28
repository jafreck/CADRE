export interface RunIssueSummary {
  issueNumber: number;
  issueTitle: string;
  success: boolean;
  prNumber?: number;
  tokens: number;
  duration: number;
  error?: string;
  wave?: number;
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

export interface RunPrCompletionFailure {
  issueNumber: number;
  issueTitle: string;
  prNumber: number;
  prUrl: string;
  branch: string;
  error: string;
}

export interface RunPrCompletion {
  queued: number;
  failed: number;
  failures: RunPrCompletionFailure[];
}

export interface CostReportAgentEntry {
  agent: string;
  tokens: number;
  inputTokens: number;
  outputTokens: number;
  estimatedCost: number;
}

export interface CostReportPhaseEntry {
  phase: number;
  phaseName: string;
  tokens: number;
  estimatedCost: number;
}

export interface CostReport {
  issueNumber: number;
  generatedAt: string;
  totalTokens: number;
  inputTokens: number;
  outputTokens: number;
  estimatedCost: number;
  model: string;
  byAgent: CostReportAgentEntry[];
  byPhase: CostReportPhaseEntry[];
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
  totals: RunTotals;
  prCompletion: RunPrCompletion;
}
