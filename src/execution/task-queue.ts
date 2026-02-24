import type { AgentSession } from '../agents/types.js';

/**
 * Returns the union of all file paths covered by a session (across all its steps).
 */
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
 * Dependency-aware session queue with topological ordering.
 * Sessions are released when all their dependencies are satisfied.
 */
export class SessionQueue {
  private readonly sessions: Map<string, AgentSession>;
  private readonly completed: Set<string> = new Set();
  private readonly blocked: Set<string> = new Set();
  private readonly inProgress: Set<string> = new Set();

  constructor(sessions: AgentSession[]) {
    this.sessions = new Map(sessions.map((s) => [s.id, s]));
    this.validate();
  }

  /**
   * Validate the session graph: check for missing dependencies and cycles.
   */
  private validate(): void {
    // Check all dependencies exist
    for (const session of this.sessions.values()) {
      for (const dep of session.dependencies) {
        if (!this.sessions.has(dep)) {
          throw new Error(
            `Session ${session.id} depends on ${dep}, which does not exist`,
          );
        }
      }
    }

    // Check for cycles via topological sort
    this.topologicalSort();
  }

  /**
   * Get sessions that are ready to execute (all dependencies satisfied).
   */
  getReady(): AgentSession[] {
    const ready: AgentSession[] = [];

    for (const session of this.sessions.values()) {
      if (this.completed.has(session.id)) continue;
      if (this.blocked.has(session.id)) continue;
      if (this.inProgress.has(session.id)) continue;

      const depsOk = session.dependencies.every(
        (dep) => this.completed.has(dep) || this.blocked.has(dep),
      );
      if (depsOk) {
        ready.push(session);
      }
    }

    return ready;
  }

  /**
   * Mark a session as in-progress.
   */
  start(sessionId: string): void {
    if (!this.sessions.has(sessionId)) {
      throw new Error(`Unknown session: ${sessionId}`);
    }
    this.inProgress.add(sessionId);
  }

  /**
   * Mark a session as completed.
   */
  complete(sessionId: string): void {
    if (!this.sessions.has(sessionId)) {
      throw new Error(`Unknown session: ${sessionId}`);
    }
    this.inProgress.delete(sessionId);
    this.completed.add(sessionId);
  }

  /**
   * Mark a session as blocked (max retries exceeded).
   */
  markBlocked(sessionId: string): void {
    if (!this.sessions.has(sessionId)) {
      throw new Error(`Unknown session: ${sessionId}`);
    }
    this.inProgress.delete(sessionId);
    this.blocked.add(sessionId);
  }

  /**
   * Check if all sessions are done (completed or blocked).
   */
  isComplete(): boolean {
    for (const session of this.sessions.values()) {
      if (!this.completed.has(session.id) && !this.blocked.has(session.id)) {
        return false;
      }
    }
    return true;
  }

  /**
   * Get a session by ID.
   */
  getSession(sessionId: string): AgentSession | undefined {
    return this.sessions.get(sessionId);
  }

  /**
   * Get all sessions.
   */
  getAllSessions(): AgentSession[] {
    return Array.from(this.sessions.values());
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
    const total = this.sessions.size;
    return {
      total,
      completed: this.completed.size,
      blocked: this.blocked.size,
      inProgress: this.inProgress.size,
      pending: total - this.completed.size - this.blocked.size - this.inProgress.size,
    };
  }

  /**
   * Check if a specific session is completed.
   */
  isTaskCompleted(sessionId: string): boolean {
    return this.completed.has(sessionId);
  }

  /**
   * Restore state from checkpoint data (for resume).
   */
  restoreState(completedTasks: string[], blockedTasks: string[]): void {
    for (const id of completedTasks) {
      if (this.sessions.has(id)) {
        this.completed.add(id);
      }
    }
    for (const id of blockedTasks) {
      if (this.sessions.has(id)) {
        this.blocked.add(id);
      }
    }
  }

  /**
   * Topological sort of all sessions. Throws if a cycle is detected.
   */
  topologicalSort(): AgentSession[] {
    const sorted: AgentSession[] = [];
    const visited = new Set<string>();
    const visiting = new Set<string>();

    const visit = (sessionId: string): void => {
      if (visited.has(sessionId)) return;
      if (visiting.has(sessionId)) {
        throw new Error(`Cycle detected in session dependencies involving: ${sessionId}`);
      }

      visiting.add(sessionId);
      const session = this.sessions.get(sessionId);
      if (!session) return;

      for (const dep of session.dependencies) {
        visit(dep);
      }

      visiting.delete(sessionId);
      visited.add(sessionId);
      sorted.push(session);
    };

    for (const sessionId of this.sessions.keys()) {
      visit(sessionId);
    }

    return sorted;
  }

  /**
   * Detect file-path collisions across a completed batch.
   * Uses the union of all step files within each session.
   * Returns one description per colliding pair.
   */
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

  /**
   * Select a batch of non-overlapping ready sessions.
   * Sessions that share files (across all their steps) cannot run in the same batch.
   */
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

/**
 * @deprecated Use SessionQueue. TaskQueue is an alias kept for backward compatibility.
 */
export const TaskQueue = SessionQueue;
