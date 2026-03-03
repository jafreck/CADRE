import type { AgentSession } from '@cadre/agent-runtime';

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

export class SessionQueue {
  private readonly sessions: Map<string, AgentSession>;
  private readonly completed: Set<string> = new Set();
  private readonly blocked: Set<string> = new Set();
  private readonly inProgress: Set<string> = new Set();

  constructor(sessions: AgentSession[]) {
    this.sessions = new Map(sessions.map((s) => [s.id, s]));
    this.validate();
  }

  private validate(): void {
    for (const session of this.sessions.values()) {
      for (const dep of session.dependencies) {
        if (!this.sessions.has(dep)) {
          throw new Error(
            `Session ${session.id} depends on ${dep}, which does not exist`,
          );
        }
      }
    }

    this.topologicalSort();
  }

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

  start(sessionId: string): void {
    if (!this.sessions.has(sessionId)) {
      throw new Error(`Unknown session: ${sessionId}`);
    }
    this.inProgress.add(sessionId);
  }

  complete(sessionId: string): void {
    if (!this.sessions.has(sessionId)) {
      throw new Error(`Unknown session: ${sessionId}`);
    }
    this.inProgress.delete(sessionId);
    this.completed.add(sessionId);
  }

  markBlocked(sessionId: string): void {
    if (!this.sessions.has(sessionId)) {
      throw new Error(`Unknown session: ${sessionId}`);
    }
    this.inProgress.delete(sessionId);
    this.blocked.add(sessionId);
  }

  isComplete(): boolean {
    for (const session of this.sessions.values()) {
      if (!this.completed.has(session.id) && !this.blocked.has(session.id)) {
        return false;
      }
    }
    return true;
  }

  getSession(sessionId: string): AgentSession | undefined {
    return this.sessions.get(sessionId);
  }

  getAllSessions(): AgentSession[] {
    return Array.from(this.sessions.values());
  }

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

  isTaskCompleted(sessionId: string): boolean {
    return this.completed.has(sessionId);
  }

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

export const TaskQueue = SessionQueue;
