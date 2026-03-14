/**
 * Checkpoint management for per-issue and fleet-level pipeline state.
 */

import { join, dirname } from 'node:path';
import { atomicWriteJSON, readJSON, exists, ensureDir, copyFile } from '../util/fs.js';
import type { Logger, GateResult, TokenRecord } from '../types.js';

export interface CheckpointStore {
  ensureDir(path: string): Promise<void>;
  exists(path: string): Promise<boolean>;
  readJSON<T>(path: string): Promise<T>;
  writeJSON(path: string, data: unknown): Promise<void>;
  copyFile(source: string, destination: string): Promise<void>;
}

export class FileSystemCheckpointStore implements CheckpointStore {
  async ensureDir(path: string): Promise<void> {
    await ensureDir(path);
  }

  async exists(path: string): Promise<boolean> {
    return exists(path);
  }

  async readJSON<T>(path: string): Promise<T> {
    return readJSON<T>(path);
  }

  async writeJSON(path: string, data: unknown): Promise<void> {
    await atomicWriteJSON(path, data);
  }

  async copyFile(source: string, destination: string): Promise<void> {
    await copyFile(source, destination);
  }
}

// ── Per-Issue Checkpoint ──

export interface FailedTask {
  taskId: string;
  error: string;
  attempts: number;
  lastAttempt: string;
}

export interface CheckpointState {
  workItemId: string;
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
  tokenRecords?: TokenRecord[];
  subTasks?: Record<string, boolean>;
  worktreePath: string;
  branchName: string;
  baseCommit: string;
  startedAt: string;
  lastCheckpoint: string;
  resumeCount: number;
  /** Number of InvocationMetric records persisted for this work item. */
  metricsCount: number;
}

// ── Fleet Checkpoint ──

export interface FleetIssueStatus {
  status: 'not-started' | 'in-progress' | 'completed' | 'failed' | 'blocked' | 'budget-exceeded' | 'code-complete' | 'dep-failed' | 'dep-merge-conflict' | 'dep-build-broken' | 'dep-blocked';
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
  issues: Record<string, FleetIssueStatus>;
  tokenUsage: { total: number; byWorkItem: Record<string, number> };
  startedAt: string;
  lastCheckpoint: string;
  resumeCount: number;
  dag?: Record<string, string[]>;
  waves?: string[][];
  completedWaves?: number[];
}

/**
 * Manages per-issue checkpoint state.
 * Checkpoint files live in the issue's progress directory.
 */
export class CheckpointManager {
  private state: CheckpointState | null = null;
  private readonly checkpointPath: string;
  private readonly backupPath: string;
  private readonly store: CheckpointStore;
  private saveLock: Promise<void> = Promise.resolve();

  constructor(
    private readonly progressDir: string,
    private readonly logger: Logger,
    store: CheckpointStore = new FileSystemCheckpointStore(),
  ) {
    this.checkpointPath = join(progressDir, 'checkpoint.json');
    this.backupPath = join(progressDir, 'checkpoint.backup.json');
    this.store = store;
  }

  /**
   * Load checkpoint from disk, or initialize a new one.
   */
  async load(issueNumber: string): Promise<CheckpointState> {
    await this.store.ensureDir(this.progressDir);

    if (await this.store.exists(this.checkpointPath)) {
      try {
        this.state = await this.store.readJSON<CheckpointState>(this.checkpointPath);
        this.state.resumeCount += 1;
        this.logger.info(`Loaded checkpoint for work item ${issueNumber}`, {
          workItemId: issueNumber,
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
          workItemId: issueNumber,
        });
        // Try backup
        if (await this.store.exists(this.backupPath)) {
          try {
            this.state = await this.store.readJSON<CheckpointState>(this.backupPath);
            this.state.resumeCount += 1;
            await this.save();
            return this.state;
          } catch {
            this.logger.warn(`Backup checkpoint also corrupt, starting fresh`, {
              workItemId: issueNumber,
            });
          }
        }
      }
    }

    // Initialize new checkpoint
    this.state = this.createEmpty(issueNumber);
    await this.save();
    return this.state;
  }

  private createEmpty(workItemId: string): CheckpointState {
    return {
      workItemId,
      version: 1,
      currentPhase: 0,
      currentTask: null,
      completedPhases: [],
      completedTasks: [],
      failedTasks: [],
      blockedTasks: [],
      phaseOutputs: {},
      gateResults: {},
      subTasks: {},
      tokenUsage: { total: 0, byPhase: {}, byAgent: {} },
      worktreePath: '',
      branchName: '',
      baseCommit: '',
      startedAt: new Date().toISOString(),
      lastCheckpoint: new Date().toISOString(),
      resumeCount: 0,
      metricsCount: 0,
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
    // Remove sub-task entries scoped to this task to keep checkpoint size bounded
    if (this.state.subTasks) {
      const prefix = `${taskId}:`;
      for (const key of Object.keys(this.state.subTasks)) {
        if (key.startsWith(prefix)) {
          delete this.state.subTasks[key];
        }
      }
    }
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
   */
  async resetPhases(phaseIds: number[]): Promise<void> {
    if (!this.state) throw new Error('Checkpoint not loaded');
    this.state.completedPhases = this.state.completedPhases.filter(
      (p) => !phaseIds.includes(p),
    );
    this.state.completedTasks = [];
    this.state.failedTasks = [];
    this.state.blockedTasks = [];
    this.state.currentTask = null;
    this.state.subTasks = {};
    for (const phaseId of phaseIds) {
      delete this.state.phaseOutputs[phaseId];
      if (this.state.gateResults) {
        delete this.state.gateResults[phaseId];
      }
    }
    await this.save();
  }

  /**
   * Persist detailed token records (input/output splits) to the checkpoint.
   */
  async saveTokenRecords(records: TokenRecord[]): Promise<void> {
    if (!this.state) throw new Error('Checkpoint not loaded');
    this.state.tokenRecords = records;
    await this.save();
  }

  /**
   * Load detailed token records from the checkpoint.
   * Returns an empty array when the field is absent (migration safety).
   */
  loadTokenRecords(): TokenRecord[] {
    return this.state?.tokenRecords ?? [];
  }

  /**
   * Increment the metrics counter and persist.
   * Call this after each InvocationMetric is written to the collector.
   */
  async incrementMetricsCount(): Promise<void> {
    if (!this.state) throw new Error('Checkpoint not loaded');
    this.state.metricsCount = (this.state.metricsCount ?? 0) + 1;
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
   * Mark a sub-task as started (sets its entry to false).
   */
  async startSubTask(subTaskId: string): Promise<void> {
    if (!this.state) throw new Error('Checkpoint not loaded');
    if (!this.state.subTasks) this.state.subTasks = {};
    this.state.subTasks[subTaskId] = false;
    await this.save();
  }

  /**
   * Mark a sub-task as completed (sets its entry to true).
   */
  async completeSubTask(subTaskId: string): Promise<void> {
    if (!this.state) throw new Error('Checkpoint not loaded');
    if (!this.state.subTasks) this.state.subTasks = {};
    this.state.subTasks[subTaskId] = true;
    await this.save();
  }

  /**
   * Check if a sub-task was already completed.
   */
  isSubTaskCompleted(subTaskId: string): boolean {
    return this.state?.subTasks?.[subTaskId] === true;
  }

  /**
   * Flush in-memory state to disk without recording any agent/token data.
   */
  async flush(): Promise<void> {
    await this.save();
  }

  /**
   * Persist the checkpoint atomically, serialized to prevent concurrent writes.
   */
  private async save(): Promise<void> {
    // Chain saves to serialize concurrent callers
    this.saveLock = this.saveLock.then(() => this.doSave()).catch(() => {});
    await this.saveLock;
  }

  private async doSave(): Promise<void> {
    if (!this.state) return;
    this.state.lastCheckpoint = new Date().toISOString();

    // Backup current checkpoint before writing new one
    if (await this.store.exists(this.checkpointPath)) {
      try {
        await this.store.copyFile(this.checkpointPath, this.backupPath);
      } catch {
        // Best-effort backup
      }
    }

    await this.store.writeJSON(this.checkpointPath, this.state);
  }
}

/**
 * Manages fleet-level checkpoint state.
 */
export class FleetCheckpointManager {
  private state: FleetCheckpointState | null = null;
  private readonly checkpointPath: string;
  private readonly store: CheckpointStore;
  private saveLock: Promise<void> = Promise.resolve();

  constructor(
    private readonly cadreDir: string,
    private readonly projectName: string,
    private readonly logger: Logger,
    store: CheckpointStore = new FileSystemCheckpointStore(),
  ) {
    this.checkpointPath = join(cadreDir, 'fleet-checkpoint.json');
    this.store = store;
  }

  async load(): Promise<FleetCheckpointState> {
    await this.store.ensureDir(this.cadreDir);

    if (await this.store.exists(this.checkpointPath)) {
      try {
        this.state = await this.store.readJSON<FleetCheckpointState>(this.checkpointPath);
        this.migrateState();
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

    // Migration: check for a legacy checkpoint at the parent directory
    // (before stateDir was namespaced by projectName). If it exists and
    // belongs to this project, copy it to the new location.
    const legacyPath = join(dirname(this.cadreDir), 'fleet-checkpoint.json');
    if (legacyPath !== this.checkpointPath && (await this.store.exists(legacyPath))) {
      try {
        const legacy = await this.store.readJSON<FleetCheckpointState>(legacyPath);
        if (legacy.projectName === this.projectName) {
          this.logger.info(
            `Migrating legacy fleet checkpoint from ${legacyPath} to ${this.checkpointPath}`,
          );
          this.state = legacy;
          this.migrateState();
          this.state.resumeCount += 1;
          await this.save();
          return this.state;
        }
      } catch {
        // Legacy file is unreadable — ignore and start fresh
      }
    }

    this.state = {
      projectName: this.projectName,
      version: 1,
      issues: {},
      tokenUsage: { total: 0, byWorkItem: {} },
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

  /**
   * Migrate legacy checkpoint state fields to the current schema.
   * - Renames `byIssue` → `byWorkItem` in tokenUsage.
   * - Ensures `tokenUsage` and `tokenUsage.byWorkItem` exist.
   */
  private migrateState(): void {
    if (!this.state) return;
    if (!this.state.tokenUsage) {
      this.state.tokenUsage = { total: 0, byWorkItem: {} };
    } else {
      const tu = this.state.tokenUsage as Record<string, unknown>;
      if (!this.state.tokenUsage.byWorkItem && tu.byIssue) {
        this.state.tokenUsage.byWorkItem = tu.byIssue as Record<string, number>;
        delete tu.byIssue;
      }
      if (!this.state.tokenUsage.byWorkItem) {
        this.state.tokenUsage.byWorkItem = {};
      }
    }
    if (!this.state.issues) {
      this.state.issues = {};
    }
  }

  async setWorkItemStatus(
    workItemId: string,
    status: FleetIssueStatus['status'],
    worktreePath: string,
    branchName: string,
    lastPhase: number,
    issueTitle: string,
    error?: string,
  ): Promise<void> {
    if (!this.state) throw new Error('Fleet checkpoint not loaded');
    this.state.issues[workItemId] = {
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

  async setDag(dag: Record<string, string[]>, waves: string[][]): Promise<void> {
    if (!this.state) throw new Error('Fleet checkpoint not loaded');
    this.state.dag = dag;
    this.state.waves = waves;
    this.state.completedWaves = [];
    await this.save();
  }

  async markWaveComplete(waveIndex: number): Promise<void> {
    if (!this.state) throw new Error('Fleet checkpoint not loaded');
    if (!this.state.completedWaves) this.state.completedWaves = [];
    if (!this.state.completedWaves.includes(waveIndex)) {
      this.state.completedWaves.push(waveIndex);
    }
    await this.save();
  }

  async recordTokenUsage(workItemId: string, tokens: number): Promise<void> {
    if (!this.state) throw new Error('Fleet checkpoint not loaded');
    this.state.tokenUsage.total += tokens;
    this.state.tokenUsage.byWorkItem[workItemId] =
      (this.state.tokenUsage.byWorkItem[workItemId] ?? 0) + tokens;
    await this.save();
  }

  getWorkItemStatus(workItemId: string): FleetIssueStatus | undefined {
    return this.state?.issues[workItemId];
  }

  /** Return all work item statuses as [workItemId, status] pairs. */
  getAllWorkItemStatuses(): Array<[string, FleetIssueStatus]> {
    if (!this.state) return [];
    return Object.entries(this.state.issues).map(
      ([id, status]) => [id, status] as [string, FleetIssueStatus],
    );
  }

  isWorkItemCompleted(workItemId: string): boolean {
    const status = this.state?.issues[workItemId]?.status;
    return status === 'completed' || status === 'budget-exceeded';
    // Note: 'code-complete' intentionally returns false — the issue still needs a PR.
    // Note: 'dep-blocked' intentionally returns false — the dependency may have been
    // resolved since the last run, so the scheduler must re-evaluate.
  }

  /**
   * Remove an issue's checkpoint entry entirely so it will be scheduled for
   * fresh processing on the next run.  Used during reconciliation to clear
   * transient failure states (e.g. dep-blocked) when their blockers have been
   * resolved.
   */
  async clearWorkItemStatus(workItemId: string): Promise<void> {
    if (!this.state) throw new Error('Fleet checkpoint not loaded');
    delete this.state.issues[workItemId];
    await this.save();
  }

  private async save(): Promise<void> {
    this.saveLock = this.saveLock.then(() => this.doSave()).catch(() => {});
    await this.saveLock;
  }

  private async doSave(): Promise<void> {
    if (!this.state) return;
    this.state.lastCheckpoint = new Date().toISOString();
    await this.store.writeJSON(this.checkpointPath, this.state);
  }
}
