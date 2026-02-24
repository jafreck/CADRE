import { join } from 'node:path';
import { atomicWriteJSON, readJSON, exists, ensureDir } from '../util/fs.js';
import { Logger } from '../logging/logger.js';
import { GateResult } from '../agents/types.js';

// ── Per-Issue Checkpoint ──

export interface FailedTask {
  taskId: string;
  error: string;
  attempts: number;
  lastAttempt: string;
}

export interface CheckpointState {
  issueNumber: number;
  version: number;
  currentPhase: number;
  currentTask: string | null;
  completedPhases: number[];
  completedTasks: string[];
  failedTasks: FailedTask[];
  blockedTasks: string[];
  phaseOutputs: Record<number, string>;
  gateResults?: Record<number, GateResult>;
  tokenUsage: {
    total: number;
    byPhase: Record<number, number>;
    byAgent: Record<string, number>;
  };
  budgetExceeded?: boolean;
  worktreePath: string;
  branchName: string;
  baseCommit: string;
  startedAt: string;
  lastCheckpoint: string;
  resumeCount: number;
}

// ── Fleet Checkpoint ──

export interface FleetIssueStatus {
  status: 'not-started' | 'in-progress' | 'completed' | 'failed' | 'blocked' | 'budget-exceeded' | 'code-complete';
  issueTitle: string;
  worktreePath: string;
  branchName: string;
  lastPhase: number;
  error?: string;
  updatedAt?: string;
}

export interface FleetCheckpointState {
  projectName: string;
  version: number;
  issues: Record<number, FleetIssueStatus>;
  tokenUsage: { total: number; byIssue: Record<number, number> };
  startedAt: string;
  lastCheckpoint: string;
  resumeCount: number;
}

/**
 * Manages per-issue checkpoint state.
 * Checkpoint files live in the issue's progress directory.
 */
export class CheckpointManager {
  private state: CheckpointState | null = null;
  private readonly checkpointPath: string;
  private readonly backupPath: string;

  constructor(
    private readonly progressDir: string,
    private readonly logger: Logger,
  ) {
    this.checkpointPath = join(progressDir, 'checkpoint.json');
    this.backupPath = join(progressDir, 'checkpoint.backup.json');
  }

  /**
   * Load checkpoint from disk, or initialize a new one.
   */
  async load(issueNumber: string): Promise<CheckpointState> {
    await ensureDir(this.progressDir);

    if (await exists(this.checkpointPath)) {
      try {
        this.state = await readJSON<CheckpointState>(this.checkpointPath);
        this.state.resumeCount += 1;
        this.logger.info(`Loaded checkpoint for issue #${issueNumber}`, {
          issueNumber: Number(issueNumber),
          data: {
            currentPhase: this.state.currentPhase,
            completedPhases: this.state.completedPhases,
            completedTasks: this.state.completedTasks,
            resumeCount: this.state.resumeCount,
          },
        });
        await this.save();
        return this.state;
      } catch (err) {
        this.logger.warn(`Failed to load checkpoint, trying backup`, {
          issueNumber: Number(issueNumber),
        });
        // Try backup
        if (await exists(this.backupPath)) {
          try {
            this.state = await readJSON<CheckpointState>(this.backupPath);
            this.state.resumeCount += 1;
            await this.save();
            return this.state;
          } catch {
            this.logger.warn(`Backup checkpoint also corrupt, starting fresh`, {
              issueNumber: Number(issueNumber),
            });
          }
        }
      }
    }

    // Initialize new checkpoint
    this.state = this.createEmpty(Number(issueNumber));
    await this.save();
    return this.state;
  }

  private createEmpty(issueNumber: number): CheckpointState {
    return {
      issueNumber,
      version: 1,
      currentPhase: 0,
      currentTask: null,
      completedPhases: [],
      completedTasks: [],
      failedTasks: [],
      blockedTasks: [],
      phaseOutputs: {},
      gateResults: {},
      tokenUsage: { total: 0, byPhase: {}, byAgent: {} },
      worktreePath: '',
      branchName: '',
      baseCommit: '',
      startedAt: new Date().toISOString(),
      lastCheckpoint: new Date().toISOString(),
      resumeCount: 0,
    };
  }

  getState(): CheckpointState {
    if (!this.state) throw new Error('Checkpoint not loaded');
    return this.state;
  }

  /**
   * Get the resume point: which phase and task to start from.
   */
  getResumePoint(): { phase: number; task: string | null } {
    if (!this.state) return { phase: 1, task: null };
    if (this.state.completedPhases.length === 0) {
      return { phase: 1, task: null };
    }
    const maxCompleted = Math.max(...this.state.completedPhases);
    return {
      phase: maxCompleted + 1,
      task: this.state.currentTask,
    };
  }

  /**
   * Mark a phase as started.
   */
  async startPhase(phaseId: number): Promise<void> {
    if (!this.state) throw new Error('Checkpoint not loaded');
    this.state.currentPhase = phaseId;
    this.state.currentTask = null;
    await this.save();
  }

  /**
   * Mark a phase as completed.
   */
  async completePhase(phaseId: number, outputPath: string): Promise<void> {
    if (!this.state) throw new Error('Checkpoint not loaded');
    if (!this.state.completedPhases.includes(phaseId)) {
      this.state.completedPhases.push(phaseId);
    }
    this.state.phaseOutputs[phaseId] = outputPath;
    this.state.currentPhase = phaseId;
    await this.save();
  }

  /**
   * Mark a task as started.
   */
  async startTask(taskId: string): Promise<void> {
    if (!this.state) throw new Error('Checkpoint not loaded');
    this.state.currentTask = taskId;
    await this.save();
  }

  /**
   * Mark a task as completed.
   */
  async completeTask(taskId: string): Promise<void> {
    if (!this.state) throw new Error('Checkpoint not loaded');
    if (!this.state.completedTasks.includes(taskId)) {
      this.state.completedTasks.push(taskId);
    }
    this.state.currentTask = null;
    await this.save();
  }

  /**
   * Mark a task as failed.
   */
  async failTask(taskId: string, error: string, attempts: number): Promise<void> {
    if (!this.state) throw new Error('Checkpoint not loaded');
    const existing = this.state.failedTasks.find((t) => t.taskId === taskId);
    if (existing) {
      existing.error = error;
      existing.attempts = attempts;
      existing.lastAttempt = new Date().toISOString();
    } else {
      this.state.failedTasks.push({
        taskId,
        error,
        attempts,
        lastAttempt: new Date().toISOString(),
      });
    }
    await this.save();
  }

  /**
   * Mark a task as blocked (max retries exceeded).
   */
  async blockTask(taskId: string): Promise<void> {
    if (!this.state) throw new Error('Checkpoint not loaded');
    if (!this.state.blockedTasks.includes(taskId)) {
      this.state.blockedTasks.push(taskId);
    }
    this.state.currentTask = null;
    await this.save();
  }

  /**
   * Record token usage for a specific agent.
   */
  async recordTokenUsage(agent: string, phase: number, tokens: number): Promise<void> {
    if (!this.state) throw new Error('Checkpoint not loaded');
    this.state.tokenUsage.total += tokens;
    this.state.tokenUsage.byPhase[phase] =
      (this.state.tokenUsage.byPhase[phase] ?? 0) + tokens;
    this.state.tokenUsage.byAgent[agent] =
      (this.state.tokenUsage.byAgent[agent] ?? 0) + tokens;
    await this.save();
  }

  /**
   * Record the gate result for a specific phase transition.
   */
  async recordGateResult(phaseId: number, result: GateResult): Promise<void> {
    if (!this.state) throw new Error('Checkpoint not loaded');
    if (!this.state.gateResults) this.state.gateResults = {};
    this.state.gateResults[phaseId] = result;
    await this.save();
  }

  /**
   * Update worktree metadata.
   */
  async setWorktreeInfo(worktreePath: string, branchName: string, baseCommit: string): Promise<void> {
    if (!this.state) throw new Error('Checkpoint not loaded');
    this.state.worktreePath = worktreePath;
    this.state.branchName = branchName;
    this.state.baseCommit = baseCommit;
    await this.save();
  }

  /**
   * Check if a phase was already completed.
   */
  isPhaseCompleted(phaseId: number): boolean {
    return this.state?.completedPhases.includes(phaseId) ?? false;
  }

  /**
   * Remove the given phase IDs from completedPhases so they will be
   * re-executed on the next run.
   *
   * Used by the review-response orchestrator to force phases 3–5 to re-run
   * against the new review-response implementation plan instead of being
   * silently skipped because the prior pipeline run already completed them.
   */
  async resetPhases(phaseIds: number[]): Promise<void> {
    if (!this.state) throw new Error('Checkpoint not loaded');
    this.state.completedPhases = this.state.completedPhases.filter(
      (p) => !phaseIds.includes(p),
    );
    // Tasks, gate results, and phase outputs have no phase-ID association in
    // the checkpoint, so clearing them all is the only correct approach when
    // rewinding phases for a review-response re-run.
    this.state.completedTasks = [];
    this.state.failedTasks = [];
    this.state.blockedTasks = [];
    this.state.currentTask = null;
    for (const phaseId of phaseIds) {
      delete this.state.phaseOutputs[phaseId];
      if (this.state.gateResults) {
        delete this.state.gateResults[phaseId];
      }
    }
    await this.save();
  }

  /**
   * Check if a task was already completed.
   */
  isTaskCompleted(taskId: string): boolean {
    return this.state?.completedTasks.includes(taskId) ?? false;
  }

  /**
   * Check if a task is blocked.
   */
  isTaskBlocked(taskId: string): boolean {
    return this.state?.blockedTasks.includes(taskId) ?? false;
  }

  /**
   * Persist the checkpoint atomically.
   */
  private async save(): Promise<void> {
    if (!this.state) return;
    this.state.lastCheckpoint = new Date().toISOString();

    // Backup current checkpoint before writing new one
    if (await exists(this.checkpointPath)) {
      try {
        const { copyFile } = await import('node:fs/promises');
        await copyFile(this.checkpointPath, this.backupPath);
      } catch {
        // Best-effort backup
      }
    }

    await atomicWriteJSON(this.checkpointPath, this.state);
  }
}

/**
 * Manages fleet-level checkpoint state.
 */
export class FleetCheckpointManager {
  private state: FleetCheckpointState | null = null;
  private readonly checkpointPath: string;

  constructor(
    private readonly cadreDir: string,
    private readonly projectName: string,
    private readonly logger: Logger,
  ) {
    this.checkpointPath = join(cadreDir, 'fleet-checkpoint.json');
  }

  async load(): Promise<FleetCheckpointState> {
    await ensureDir(this.cadreDir);

    if (await exists(this.checkpointPath)) {
      try {
        this.state = await readJSON<FleetCheckpointState>(this.checkpointPath);
        this.state.resumeCount += 1;
        this.logger.info('Loaded fleet checkpoint', {
          data: {
            issues: Object.keys(this.state.issues).length,
            resumeCount: this.state.resumeCount,
          },
        });
        await this.save();
        return this.state;
      } catch {
        this.logger.warn('Failed to load fleet checkpoint, starting fresh');
      }
    }

    this.state = {
      projectName: this.projectName,
      version: 1,
      issues: {},
      tokenUsage: { total: 0, byIssue: {} },
      startedAt: new Date().toISOString(),
      lastCheckpoint: new Date().toISOString(),
      resumeCount: 0,
    };
    await this.save();
    return this.state;
  }

  getState(): FleetCheckpointState {
    if (!this.state) throw new Error('Fleet checkpoint not loaded');
    return this.state;
  }

  async setIssueStatus(
    issueNumber: number,
    status: FleetIssueStatus['status'],
    worktreePath: string,
    branchName: string,
    lastPhase: number,
    issueTitle: string,
    error?: string,
  ): Promise<void> {
    if (!this.state) throw new Error('Fleet checkpoint not loaded');
    this.state.issues[issueNumber] = {
      status,
      issueTitle,
      worktreePath,
      branchName,
      lastPhase,
      error,
      updatedAt: new Date().toISOString(),
    };
    await this.save();
  }

  async recordTokenUsage(issueNumber: number, tokens: number): Promise<void> {
    if (!this.state) throw new Error('Fleet checkpoint not loaded');
    this.state.tokenUsage.total += tokens;
    this.state.tokenUsage.byIssue[issueNumber] =
      (this.state.tokenUsage.byIssue[issueNumber] ?? 0) + tokens;
    await this.save();
  }

  getIssueStatus(issueNumber: number): FleetIssueStatus | undefined {
    return this.state?.issues[issueNumber];
  }

  isIssueCompleted(issueNumber: number): boolean {
    const status = this.state?.issues[issueNumber]?.status;
    return status === 'completed' || status === 'budget-exceeded';
    // Note: 'code-complete' intentionally returns false — the issue still needs a PR.
  }

  private async save(): Promise<void> {
    if (!this.state) return;
    this.state.lastCheckpoint = new Date().toISOString();
    await atomicWriteJSON(this.checkpointPath, this.state);
  }
}
