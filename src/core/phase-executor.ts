import type { RuntimeConfig } from '../config/loader.js';
import type { IssueDetail, PlatformProvider, PullRequestInfo } from '../platform/provider.js';
import type { WorktreeInfo } from '../git/worktree.js';
import type { CheckpointManager } from './checkpoint.js';
import type { IssueProgressWriter } from './progress.js';
import type { AgentLauncher } from './agent-launcher.js';
import type { ContextBuilder } from '../agents/context-builder.js';
import type { ResultParser } from '../agents/result-parser.js';
import type { CommitManager } from '../git/commit.js';
import type { RetryExecutor } from '../execution/retry.js';
import type { TokenTracker } from '../budget/token-tracker.js';
import type { Logger } from '../logging/logger.js';

/** Cross-cutting services used by every phase. */
export type PhaseServices = {
  launcher: AgentLauncher;
  retryExecutor: RetryExecutor;
  tokenTracker: TokenTracker;
  contextBuilder: ContextBuilder;
  resultParser: ResultParser;
  logger: Logger;
};

/** I/O and persistence dependencies. */
export type PhaseIO = {
  progressDir: string;
  progressWriter: IssueProgressWriter;
  checkpoint: CheckpointManager;
  commitManager: CommitManager;
};

/** Callbacks injected by the orchestrator. */
export type PhaseCallbacks = {
  recordTokens: (agent: string, tokens: number | null) => void;
  checkBudget: () => void;
  updateProgress: () => Promise<void>;
  onPRCreated?: (pr: PullRequestInfo) => void;
  onPRFailed?: () => void;
};

/**
 * All dependencies and shared state needed by a phase during execution.
 */
export type PhaseContext = {
  issue: IssueDetail;
  worktree: WorktreeInfo;
  config: RuntimeConfig;
  platform: PlatformProvider;
  services: PhaseServices;
  io: PhaseIO;
  callbacks: PhaseCallbacks;
};

/**
 * Contract for a single phase in the CADRE per-issue pipeline.
 */
export interface PhaseExecutor {
  /** Pipeline phase number (1-based). */
  phaseId: number;
  /** Human-readable phase name. */
  name: string;
  /** Execute the phase and return the path to the primary output file. */
  execute(ctx: PhaseContext): Promise<string>;
}
