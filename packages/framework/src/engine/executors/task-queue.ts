import type { AgentSession } from '../../runtime/context/types.js';

/** Minimal shape required by TaskQueue for DAG resolution. */
export interface TaskLike {
  id: string;
  dependencies: string[];
}

function sessionFiles(session: AgentSession): string[] {
  const seen = new Set<string>();
  const files: string[] = [];
  for (const step of session.steps) {
    for (const f of step.files) {
      if (!seen.has(f)) {
        seen.add(f);
        files.push(f);
      }
    }
  }
  return files;
}

/**
 * Generic task queue with DAG resolution, topological sort, and
 * ready/complete/blocked state machine.
 *
 * `T` must have at least `{ id: string; dependencies: string[] }`.
 */
export class TaskQueue<T extends TaskLike = TaskLike> {
  private readonly tasks: Map<string, T>;
  private readonly completed: Set<string> = new Set();
  private readonly blocked: Set<string> = new Set();
  private readonly inProgress: Set<string> = new Set();

  constructor(tasks: T[]) {
    this.tasks = new Map(tasks.map((t) => [t.id, t]));
    this.validate();
  }

  private validate(): void {
    for (const task of this.tasks.values()) {
      for (const dep of task.dependencies) {
        if (!this.tasks.has(dep)) {
          throw new Error(
            `Task ${task.id} depends on ${dep}, which does not exist`,
          );
        }
      }
    }

    this.topologicalSort();
  }

  getReady(): T[] {
    const ready: T[] = [];

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

  start(taskId: string): void {
    if (!this.tasks.has(taskId)) {
      throw new Error(`Unknown task: ${taskId}`);
    }
    this.inProgress.add(taskId);
  }

  complete(taskId: string): void {
    if (!this.tasks.has(taskId)) {
      throw new Error(`Unknown task: ${taskId}`);
    }
    this.inProgress.delete(taskId);
    this.completed.add(taskId);
  }

  markBlocked(taskId: string): void {
    if (!this.tasks.has(taskId)) {
      throw new Error(`Unknown task: ${taskId}`);
    }
    this.inProgress.delete(taskId);
    this.blocked.add(taskId);
  }

  isComplete(): boolean {
    for (const task of this.tasks.values()) {
      if (!this.completed.has(task.id) && !this.blocked.has(task.id)) {
        return false;
      }
    }
    return true;
  }

  getTask(taskId: string): T | undefined {
    return this.tasks.get(taskId);
  }

  getAllTasks(): T[] {
    return Array.from(this.tasks.values());
  }

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

  isTaskCompleted(taskId: string): boolean {
    return this.completed.has(taskId);
  }

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

  topologicalSort(): T[] {
    const sorted: T[] = [];
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
}

/**
 * AgentSession-specific queue with file-overlap collision detection.
 * Extends TaskQueue<AgentSession> with batch collision and non-overlapping
 * batch selection methods.
 */
export class SessionQueue extends TaskQueue<AgentSession> {
  static detectBatchCollisions(sessions: AgentSession[]): string[] {
    const fileToSessions = new Map<string, string[]>();

    for (const session of sessions) {
      for (const file of sessionFiles(session)) {
        const owners = fileToSessions.get(file) ?? [];
        owners.push(session.id);
        fileToSessions.set(file, owners);
      }
    }

    const collisions: string[] = [];
    for (const [file, owners] of fileToSessions) {
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

  static selectNonOverlappingBatch(
    readySessions: AgentSession[],
    maxBatchSize: number,
  ): AgentSession[] {
    const batch: AgentSession[] = [];
    const claimedFiles = new Set<string>();

    for (const session of readySessions) {
      if (batch.length >= maxBatchSize) break;
      const files = sessionFiles(session);
      const hasOverlap = files.some((f) => claimedFiles.has(f));
      if (!hasOverlap) {
        batch.push(session);
        for (const f of files) {
          claimedFiles.add(f);
        }
      }
    }

    return batch;
  }
}
