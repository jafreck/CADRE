/**
 * Phase executor interface and context types for multi-phase pipelines.
 *
 * The generic PhaseContext uses explicit generic parameters and `unknown`
 * defaults so consumers can narrow to concrete types safely.
 */

/** Cross-cutting services used by every phase. */
export type PhaseServices<
  TLauncher = unknown,
  TRetryExecutor = unknown,
  TTokenTracker = unknown,
  TContextBuilder = unknown,
  TResultParser = unknown,
  TLogger = unknown,
> = {
  launcher: TLauncher;
  retryExecutor: TRetryExecutor;
  tokenTracker: TTokenTracker;
  contextBuilder: TContextBuilder;
  resultParser: TResultParser;
  logger: TLogger;
};

/** I/O and persistence dependencies. */
export type PhaseIO<
  TProgressWriter = unknown,
  TCheckpoint = unknown,
  TCommitManager = unknown,
> = {
  progressDir: string;
  progressWriter: TProgressWriter;
  checkpoint: TCheckpoint;
  commitManager: TCommitManager;
};

/** Callbacks injected by the orchestrator. */
export type PhaseCallbacks<TTokens = unknown, TPullRequest = unknown> = {
  recordTokens(agent: string, tokens: TTokens): void;
  checkBudget(): void;
  updateProgress(): Promise<void>;
  setPR?(pr: TPullRequest): void;
};

/**
 * All dependencies and shared state needed by a phase during execution.
 *
 * Concrete types for each field are defined in the consumer's own
 * PhaseContext (see src/core/phase-executor.ts for the CADRE-specific version).
 */
export type PhaseContext<
  TWorkItem = unknown,
  TWorkspace = unknown,
  TConfig = unknown,
  TPlatform = unknown,
  TServices = PhaseServices,
  TIO = PhaseIO,
  TCallbacks = PhaseCallbacks,
> = {
  issue: TWorkItem;
  worktree: TWorkspace;
  config: TConfig;
  platform: TPlatform;
  services: TServices;
  io: TIO;
  callbacks: TCallbacks;
};

/**
 * Contract for a single phase in a multi-phase pipeline.
 */
export interface PhaseExecutor<TContext extends PhaseContext = PhaseContext> {
  /** Pipeline phase number (1-based). */
  phaseId: number;
  /** Human-readable phase name. */
  name: string;
  /** Execute the phase and return the path to the primary output file. */
  execute(ctx: TContext): Promise<string>;
  /**
   * Optional: validate that a previously-completed run of this phase is still
   * valid.  Return `true` if the prior result is still good and the phase can
   * be skipped; return `false` to force re-execution.
   *
   * When not implemented, completed phases are always skipped on resume.
   */
  validatePriorCompletion?(ctx: TContext): Promise<boolean>;
}
