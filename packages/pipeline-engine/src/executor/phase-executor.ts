/**
 * Phase executor interface and context types for multi-phase pipelines.
 *
 * The generic PhaseContext uses `any` for services, I/O, and callbacks so
 * that downstream consumers (e.g. src/core/phase-executor.ts) can narrow
 * these to concrete types without type incompatibilities.
 */

import type { Logger, TokenRecord } from '../types.js';
import type { CheckpointManager } from '../checkpoint/checkpoint.js';
import type { IssueProgressWriter } from '../progress/progress.js';

/** Cross-cutting services used by every phase. */
export interface PhaseServices {
  launcher: {
    launch(invocation: { agent: string; contextPath: string; outputPath: string; timeout?: number }): Promise<{ success: boolean; exitCode: number | null; timedOut: boolean; duration: number; stdout: string; stderr: string; tokenUsage: unknown; outputPath: string; outputExists: boolean; error?: string }>;
  };
  retryExecutor: {
    executeWithRetry<T>(fn: () => Promise<T>, maxRetries?: number): Promise<T>;
  };
  tokenTracker: {
    record(agent: string, phase: number, tokens: number): void;
    getTotal(): number;
  };
  contextBuilder: {
    build(params: Record<string, unknown>): Promise<string>;
  };
  resultParser: {
    parse(outputPath: string): Promise<unknown>;
  };
  logger: Logger;
}

/** I/O and persistence dependencies. */
export interface PhaseIO {
  progressDir: string;
  progressWriter: IssueProgressWriter;
  checkpoint: CheckpointManager;
  commitManager: {
    commitPhase(message: string): Promise<string | null>;
  };
}

/** Callbacks injected by the orchestrator. */
export interface PhaseCallbacks {
  recordTokens: (agent: string, tokens: { input?: number; output?: number; total: number }) => void;
  checkBudget: () => void;
  updateProgress: () => Promise<void>;
  setPR?: (pr: { number: number; url: string }) => void;
}

/**
 * All dependencies and shared state needed by a phase during execution.
 *
 * Concrete types for each field are defined in the consumer's own
 * PhaseContext (see src/core/phase-executor.ts for the CADRE-specific version).
 */
export type PhaseContext = {
  issue: any;
  worktree: any;
  config: any;
  platform: any;
  services: PhaseServices;
  io: PhaseIO;
  callbacks: PhaseCallbacks;
};

/**
 * Contract for a single phase in a multi-phase pipeline.
 */
export interface PhaseExecutor {
  /** Pipeline phase number (1-based). */
  phaseId: number;
  /** Human-readable phase name. */
  name: string;
  /** Execute the phase and return the path to the primary output file. */
  execute(ctx: PhaseContext): Promise<string>;
}
