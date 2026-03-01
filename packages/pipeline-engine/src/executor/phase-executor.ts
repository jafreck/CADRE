/**
 * Phase executor interface and context types for multi-phase pipelines.
 *
 * The generic PhaseContext uses `any` for services, I/O, and callbacks so
 * that downstream consumers (e.g. src/core/phase-executor.ts) can narrow
 * these to concrete types without type incompatibilities.
 */

/** Cross-cutting services used by every phase. */
export type PhaseServices = {
  launcher: any;
  retryExecutor: any;
  tokenTracker: any;
  contextBuilder: any;
  resultParser: any;
  logger: any;
};

/** I/O and persistence dependencies. */
export type PhaseIO = {
  progressDir: string;
  progressWriter: any;
  checkpoint: any;
  commitManager: any;
};

/** Callbacks injected by the orchestrator. */
export type PhaseCallbacks = {
  recordTokens: (agent: string, tokens: any) => void;
  checkBudget: () => void;
  updateProgress: () => Promise<void>;
  setPR?: (pr: any) => void;
};

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
