import { describe, it, expect } from 'vitest';
import { SessionQueue, TaskQueue } from '../src/execution/task-queue.js';
import type { AgentSession } from '../src/agents/types.js';

function makeSession(
  id: string,
  deps: string[] = [],
  files: string[] = [],
): AgentSession {
  return {
    id,
    name: `Session ${id}`,
    rationale: `Rationale for ${id}`,
    dependencies: deps,
    steps: [
      {
        id: `${id}-step-001`,
        name: `Step 1 of ${id}`,
        description: `Description for ${id}`,
        files: files.length ? files : [`src/${id}.ts`],
        complexity: 'simple' as const,
        acceptanceCriteria: ['criterion 1'],
      },
    ],
  };
}

// Alias for backward-compat tests — TaskQueue is SessionQueue
const makeTask = makeSession;

describe('SessionQueue (also exported as TaskQueue)', () => {
  it('TaskQueue is an alias for SessionQueue', () => {
    expect(TaskQueue).toBe(SessionQueue);
  });
});

describe('TaskQueue', () => {
  describe('construction and validation', () => {
    it('should accept a valid session list', () => {
      const queue = new TaskQueue([
        makeSession('session-001'),
        makeSession('session-002', ['session-001']),
      ]);
      expect(queue.getCounts().total).toBe(2);
    });

    it('should throw on missing dependencies', () => {
      expect(() =>
        new TaskQueue([
          makeSession('session-001', ['session-999']),
        ]),
      ).toThrow('does not exist');
    });

    it('should throw on circular dependencies', () => {
      expect(() =>
        new TaskQueue([
          makeSession('session-001', ['session-002']),
          makeSession('session-002', ['session-001']),
        ]),
      ).toThrow('Cycle detected');
    });

    it('should detect transitive cycles', () => {
      expect(() =>
        new TaskQueue([
          makeSession('session-001', ['session-003']),
          makeSession('session-002', ['session-001']),
          makeSession('session-003', ['session-002']),
        ]),
      ).toThrow('Cycle detected');
    });
  });

  describe('getReady', () => {
    it('should return sessions with no dependencies', () => {
      const queue = new TaskQueue([
        makeSession('session-001'),
        makeSession('session-002', ['session-001']),
        makeSession('session-003'),
      ]);

      const ready = queue.getReady();
      const readyIds = ready.map((t) => t.id);
      expect(readyIds).toContain('session-001');
      expect(readyIds).toContain('session-003');
      expect(readyIds).not.toContain('session-002');
    });

    it('should release sessions when dependencies complete', () => {
      const queue = new TaskQueue([
        makeSession('session-001'),
        makeSession('session-002', ['session-001']),
      ]);

      queue.start('session-001');
      queue.complete('session-001');

      const ready = queue.getReady();
      expect(ready.map((t) => t.id)).toContain('session-002');
    });

    it('should not include in-progress sessions', () => {
      const queue = new TaskQueue([
        makeSession('session-001'),
        makeSession('session-002'),
      ]);

      queue.start('session-001');
      const ready = queue.getReady();
      expect(ready.map((t) => t.id)).not.toContain('session-001');
      expect(ready.map((t) => t.id)).toContain('session-002');
    });
  });

  describe('state transitions', () => {
    it('should track completion correctly', () => {
      const queue = new TaskQueue([
        makeSession('session-001'),
        makeSession('session-002'),
      ]);

      queue.start('session-001');
      queue.complete('session-001');

      expect(queue.isTaskCompleted('session-001')).toBe(true);
      expect(queue.getCounts().completed).toBe(1);
    });

    it('should handle blocked sessions', () => {
      const queue = new TaskQueue([
        makeSession('session-001'),
        makeSession('session-002', ['session-001']),
      ]);

      queue.start('session-001');
      queue.markBlocked('session-001');

      expect(queue.getCounts().blocked).toBe(1);
      // Blocked dep still releases downstream sessions
      const ready = queue.getReady();
      expect(ready.map((t) => t.id)).toContain('session-002');
    });

    it('should report isComplete when all done', () => {
      const queue = new TaskQueue([
        makeSession('session-001'),
        makeSession('session-002'),
      ]);

      expect(queue.isComplete()).toBe(false);

      queue.start('session-001');
      queue.complete('session-001');
      queue.start('session-002');
      queue.complete('session-002');

      expect(queue.isComplete()).toBe(true);
    });

    it('should throw on unknown session operations', () => {
      const queue = new TaskQueue([makeSession('session-001')]);
      expect(() => queue.start('session-999')).toThrow('Unknown session');
      expect(() => queue.complete('session-999')).toThrow('Unknown session');
      expect(() => queue.markBlocked('session-999')).toThrow('Unknown session');
    });
  });

  describe('restoreState', () => {
    it('should restore completed and blocked sessions', () => {
      const queue = new TaskQueue([
        makeSession('session-001'),
        makeSession('session-002', ['session-001']),
        makeSession('session-003', ['session-001']),
      ]);

      queue.restoreState(['session-001'], ['session-003']);

      expect(queue.isTaskCompleted('session-001')).toBe(true);
      expect(queue.getCounts().blocked).toBe(1);
      expect(queue.getCounts().completed).toBe(1);

      const ready = queue.getReady();
      expect(ready.map((t) => t.id)).toContain('session-002');
    });
  });

  describe('topologicalSort', () => {
    it('should return sessions in dependency order', () => {
      const queue = new TaskQueue([
        makeSession('session-003', ['session-002']),
        makeSession('session-001'),
        makeSession('session-002', ['session-001']),
      ]);

      const sorted = queue.topologicalSort();
      const ids = sorted.map((t) => t.id);
      expect(ids.indexOf('session-001')).toBeLessThan(ids.indexOf('session-002'));
      expect(ids.indexOf('session-002')).toBeLessThan(ids.indexOf('session-003'));
    });
  });

  describe('detectBatchCollisions', () => {
    it('should return empty array when no sessions share a file', () => {
      const sessions = [
        makeTask('session-001', [], ['src/a.ts']),
        makeTask('session-002', [], ['src/b.ts']),
        makeTask('session-003', [], ['src/c.ts']),
      ];

      const collisions = TaskQueue.detectBatchCollisions(sessions);
      expect(collisions).toEqual([]);
    });

    it('should return one collision entry for a pair sharing a file', () => {
      const sessions = [
        makeTask('session-001', [], ['src/a.ts']),
        makeTask('session-002', [], ['src/a.ts']),
      ];

      const collisions = TaskQueue.detectBatchCollisions(sessions);
      expect(collisions).toHaveLength(1);
      expect(collisions[0]).toContain('src/a.ts');
      expect(collisions[0]).toContain('session-001');
      expect(collisions[0]).toContain('session-002');
    });

    it('should return separate entries for multiple colliding pairs', () => {
      const sessions = [
        makeTask('session-001', [], ['src/a.ts', 'src/b.ts']),
        makeTask('session-002', [], ['src/a.ts']),
        makeTask('session-003', [], ['src/b.ts']),
      ];

      const collisions = TaskQueue.detectBatchCollisions(sessions);
      expect(collisions).toHaveLength(2);
      const combined = collisions.join('\n');
      expect(combined).toContain('src/a.ts');
      expect(combined).toContain('src/b.ts');
    });

    it('should return three entries for three sessions sharing the same file', () => {
      const sessions = [
        makeTask('session-001', [], ['src/shared.ts']),
        makeTask('session-002', [], ['src/shared.ts']),
        makeTask('session-003', [], ['src/shared.ts']),
      ];

      const collisions = TaskQueue.detectBatchCollisions(sessions);
      // Pairs: (001,002), (001,003), (002,003)
      expect(collisions).toHaveLength(3);
    });

    it('should return empty array for an empty session list', () => {
      const collisions = TaskQueue.detectBatchCollisions([]);
      expect(collisions).toEqual([]);
    });

    it('should return empty array for a single-session batch', () => {
      const sessions = [makeTask('session-001', [], ['src/a.ts'])];
      const collisions = TaskQueue.detectBatchCollisions(sessions);
      expect(collisions).toEqual([]);
    });

    it('should detect collision when two sessions share a test file', () => {
      const sessions = [
        makeTask('session-001', [], ['src/a.ts', 'tests/foo.test.ts']),
        makeTask('session-002', [], ['src/b.ts', 'tests/foo.test.ts']),
      ];

      const collisions = TaskQueue.detectBatchCollisions(sessions);
      expect(collisions).toHaveLength(1);
      expect(collisions[0]).toContain('tests/foo.test.ts');
      expect(collisions[0]).toContain('session-001');
      expect(collisions[0]).toContain('session-002');
    });

    it('should not report a collision for a session that owns a file exclusively', () => {
      const sessions = [
        makeTask('session-001', [], ['src/a.ts', 'src/b.ts']),
        makeTask('session-002', [], ['src/b.ts']),
      ];

      const collisions = TaskQueue.detectBatchCollisions(sessions);
      expect(collisions).toHaveLength(1);
      expect(collisions[0]).toContain('src/b.ts');
      expect(collisions[0]).not.toContain('src/a.ts');
    });
  });

  describe('selectNonOverlappingBatch', () => {
    it('should select sessions with non-overlapping files', () => {
      const sessions = [
        makeTask('session-001', [], ['src/a.ts']),
        makeTask('session-002', [], ['src/b.ts']),
        makeTask('session-003', [], ['src/a.ts']), // overlaps with session-001
      ];

      const batch = TaskQueue.selectNonOverlappingBatch(sessions, 10);
      const batchIds = batch.map((t) => t.id);

      expect(batchIds).toContain('session-001');
      expect(batchIds).toContain('session-002');
      expect(batchIds).not.toContain('session-003');
    });

    it('should respect max batch size', () => {
      const sessions = [
        makeTask('session-001', [], ['src/a.ts']),
        makeTask('session-002', [], ['src/b.ts']),
        makeTask('session-003', [], ['src/c.ts']),
      ];

      const batch = TaskQueue.selectNonOverlappingBatch(sessions, 2);
      expect(batch.length).toBe(2);
    });

    it('should handle empty input', () => {
      const batch = TaskQueue.selectNonOverlappingBatch([], 5);
      expect(batch.length).toBe(0);
    });
  });
});

