import type { ImplementationTask } from '../agents/types.js';

/**
 * Dependency-aware task queue with topological ordering.
 * Tasks are released when all their dependencies are satisfied.
 */
export class TaskQueue {
  private readonly tasks: Map<string, ImplementationTask>;
  private readonly completed: Set<string> = new Set();
  private readonly blocked: Set<string> = new Set();
  private readonly inProgress: Set<string> = new Set();

  constructor(tasks: ImplementationTask[]) {
    this.tasks = new Map(tasks.map((t) => [t.id, t]));
    this.validate();
  }

  /**
   * Validate the task graph: check for missing dependencies and cycles.
   */
  private validate(): void {
    // Check all dependencies exist
    for (const task of this.tasks.values()) {
      for (const dep of task.dependencies) {
        if (!this.tasks.has(dep)) {
          throw new Error(
            `Task ${task.id} depends on ${dep}, which does not exist`,
          );
        }
      }
    }

    // Check for cycles via topological sort
    this.topologicalSort();
  }

  /**
   * Get tasks that are ready to execute (all dependencies satisfied).
   */
  getReady(): ImplementationTask[] {
    const ready: ImplementationTask[] = [];

    for (const task of this.tasks.values()) {
      if (this.completed.has(task.id)) continue;
      if (this.blocked.has(task.id)) continue;
      if (this.inProgress.has(task.id)) continue;

      const depsOk = task.dependencies.every(
        (dep) => this.completed.has(dep) || this.blocked.has(dep),
      );
      if (depsOk) {
        ready.push(task);
      }
    }

    return ready;
  }

  /**
   * Mark a task as in-progress.
   */
  start(taskId: string): void {
    if (!this.tasks.has(taskId)) {
      throw new Error(`Unknown task: ${taskId}`);
    }
    this.inProgress.add(taskId);
  }

  /**
   * Mark a task as completed.
   */
  complete(taskId: string): void {
    if (!this.tasks.has(taskId)) {
      throw new Error(`Unknown task: ${taskId}`);
    }
    this.inProgress.delete(taskId);
    this.completed.add(taskId);
  }

  /**
   * Mark a task as blocked (max retries exceeded).
   */
  markBlocked(taskId: string): void {
    if (!this.tasks.has(taskId)) {
      throw new Error(`Unknown task: ${taskId}`);
    }
    this.inProgress.delete(taskId);
    this.blocked.add(taskId);
  }

  /**
   * Check if all tasks are done (completed or blocked).
   */
  isComplete(): boolean {
    for (const task of this.tasks.values()) {
      if (!this.completed.has(task.id) && !this.blocked.has(task.id)) {
        return false;
      }
    }
    return true;
  }

  /**
   * Get a task by ID.
   */
  getTask(taskId: string): ImplementationTask | undefined {
    return this.tasks.get(taskId);
  }

  /**
   * Get all tasks.
   */
  getAllTasks(): ImplementationTask[] {
    return Array.from(this.tasks.values());
  }

  /**
   * Get counts for progress reporting.
   */
  getCounts(): {
    total: number;
    completed: number;
    blocked: number;
    inProgress: number;
    pending: number;
  } {
    const total = this.tasks.size;
    return {
      total,
      completed: this.completed.size,
      blocked: this.blocked.size,
      inProgress: this.inProgress.size,
      pending: total - this.completed.size - this.blocked.size - this.inProgress.size,
    };
  }

  /**
   * Check if a specific task is completed.
   */
  isTaskCompleted(taskId: string): boolean {
    return this.completed.has(taskId);
  }

  /**
   * Restore state from checkpoint data (for resume).
   */
  restoreState(completedTasks: string[], blockedTasks: string[]): void {
    for (const id of completedTasks) {
      if (this.tasks.has(id)) {
        this.completed.add(id);
      }
    }
    for (const id of blockedTasks) {
      if (this.tasks.has(id)) {
        this.blocked.add(id);
      }
    }
  }

  /**
   * Topological sort of all tasks. Throws if a cycle is detected.
   */
  topologicalSort(): ImplementationTask[] {
    const sorted: ImplementationTask[] = [];
    const visited = new Set<string>();
    const visiting = new Set<string>();

    const visit = (taskId: string): void => {
      if (visited.has(taskId)) return;
      if (visiting.has(taskId)) {
        throw new Error(`Cycle detected in task dependencies involving: ${taskId}`);
      }

      visiting.add(taskId);
      const task = this.tasks.get(taskId);
      if (!task) return;

      for (const dep of task.dependencies) {
        visit(dep);
      }

      visiting.delete(taskId);
      visited.add(taskId);
      sorted.push(task);
    };

    for (const taskId of this.tasks.keys()) {
      visit(taskId);
    }

    return sorted;
  }

  /**
   * Detect file-path collisions across a completed batch.
   * Returns one description per colliding pair, e.g.
   *   "File src/foo.ts claimed by both task-001 and task-003"
   */
  static detectBatchCollisions(tasks: ImplementationTask[]): string[] {
    const fileToTasks = new Map<string, string[]>();

    for (const task of tasks) {
      for (const file of task.files) {
        const owners = fileToTasks.get(file) ?? [];
        owners.push(task.id);
        fileToTasks.set(file, owners);
      }
    }

    const collisions: string[] = [];
    for (const [file, owners] of fileToTasks) {
      if (owners.length < 2) continue;
      for (let i = 0; i < owners.length - 1; i++) {
        for (let j = i + 1; j < owners.length; j++) {
          collisions.push(
            `File ${file} claimed by both ${owners[i]} and ${owners[j]}`,
          );
        }
      }
    }

    return collisions;
  }

  /**
   * Select a batch of non-overlapping ready tasks.
   * Tasks that modify the same files cannot run in the same batch.
   */
  static selectNonOverlappingBatch(
    readyTasks: ImplementationTask[],
    maxBatchSize: number,
  ): ImplementationTask[] {
    const batch: ImplementationTask[] = [];
    const claimedFiles = new Set<string>();

    for (const task of readyTasks) {
      if (batch.length >= maxBatchSize) break;
      const hasOverlap = task.files.some((f) => claimedFiles.has(f));
      if (!hasOverlap) {
        batch.push(task);
        for (const f of task.files) {
          claimedFiles.add(f);
        }
      }
    }

    return batch;
  }
}
