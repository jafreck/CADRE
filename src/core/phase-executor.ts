/**
 * Phase executor types for CADRE's per-issue pipeline.
 *
 * The generic PhaseExecutor interface is provided by @cadre-dev/framework/engine.
 * Cadre-specific context types are defined here for full type safety.
 */

import type { PhaseExecutor as EnginePhaseExecutor } from '@cadre-dev/framework/engine';

import type { RuntimeConfig } from '../config/loader.js';
import type { IssueDetail, PlatformProvider, PullRequestInfo } from '../platform/provider.js';
import type { WorktreeInfo } from '../git/worktree.js';
import type { CheckpointManager, IssueProgressWriter } from '@cadre-dev/framework/engine';
import type { AgentLauncher } from './agent-launcher.js';
import type { ContextBuilder } from '../agents/context-builder.js';
import type { ResultParser } from '../agents/result-parser.js';
import type { CommitManager } from '../git/commit.js';
import type { RetryExecutor } from '@cadre-dev/framework/engine';
import type { TokenTracker } from '@cadre-dev/framework/runtime';
import type { Logger } from '@cadre-dev/framework/core';
import type { TokenUsageDetail } from '../agents/types.js';

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
  recordTokens: (agent: string, tokens: TokenUsageDetail | number | null) => void;
  checkBudget: () => void;
  updateProgress: () => Promise<void>;
  setPR?: (pr: PullRequestInfo) => void;
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

export type PhaseExecutor = EnginePhaseExecutor<PhaseContext>;
