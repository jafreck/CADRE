import { describe, it, expect } from 'vitest';
import { TaskQueue } from '../src/execution/task-queue.js';
import type { ImplementationTask } from '../src/agents/types.js';

function makeTask(
  id: string,
  deps: string[] = [],
  files: string[] = [],
): ImplementationTask {
  return {
    id,
    name: `Task ${id}`,
    description: `Description for ${id}`,
    files: files.length ? files : [`src/${id}.ts`],
    dependencies: deps,
    complexity: 'simple' as const,
    acceptanceCriteria: ['criterion 1'],
  };
}

describe('TaskQueue', () => {
  describe('construction and validation', () => {
    it('should accept a valid task list', () => {
      const queue = new TaskQueue([
        makeTask('task-001'),
        makeTask('task-002', ['task-001']),
      ]);
      expect(queue.getCounts().total).toBe(2);
    });

    it('should throw on missing dependencies', () => {
      expect(() =>
        new TaskQueue([
          makeTask('task-001', ['task-999']),
        ]),
      ).toThrow('does not exist');
    });

    it('should throw on circular dependencies', () => {
      expect(() =>
        new TaskQueue([
          makeTask('task-001', ['task-002']),
          makeTask('task-002', ['task-001']),
        ]),
      ).toThrow('Cycle detected');
    });

    it('should detect transitive cycles', () => {
      expect(() =>
        new TaskQueue([
          makeTask('task-001', ['task-003']),
          makeTask('task-002', ['task-001']),
          makeTask('task-003', ['task-002']),
        ]),
      ).toThrow('Cycle detected');
    });
  });

  describe('getReady', () => {
    it('should return tasks with no dependencies', () => {
      const queue = new TaskQueue([
        makeTask('task-001'),
        makeTask('task-002', ['task-001']),
        makeTask('task-003'),
      ]);

      const ready = queue.getReady();
      const readyIds = ready.map((t) => t.id);
      expect(readyIds).toContain('task-001');
      expect(readyIds).toContain('task-003');
      expect(readyIds).not.toContain('task-002');
    });

    it('should release tasks when dependencies complete', () => {
      const queue = new TaskQueue([
        makeTask('task-001'),
        makeTask('task-002', ['task-001']),
      ]);

      queue.start('task-001');
      queue.complete('task-001');

      const ready = queue.getReady();
      expect(ready.map((t) => t.id)).toContain('task-002');
    });

    it('should not include in-progress tasks', () => {
      const queue = new TaskQueue([
        makeTask('task-001'),
        makeTask('task-002'),
      ]);

      queue.start('task-001');
      const ready = queue.getReady();
      expect(ready.map((t) => t.id)).not.toContain('task-001');
      expect(ready.map((t) => t.id)).toContain('task-002');
    });
  });

  describe('state transitions', () => {
    it('should track completion correctly', () => {
      const queue = new TaskQueue([
        makeTask('task-001'),
        makeTask('task-002'),
      ]);

      queue.start('task-001');
      queue.complete('task-001');

      expect(queue.isTaskCompleted('task-001')).toBe(true);
      expect(queue.getCounts().completed).toBe(1);
    });

    it('should handle blocked tasks', () => {
      const queue = new TaskQueue([
        makeTask('task-001'),
        makeTask('task-002', ['task-001']),
      ]);

      queue.start('task-001');
      queue.markBlocked('task-001');

      expect(queue.getCounts().blocked).toBe(1);
      // Blocked dep still releases downstream tasks
      const ready = queue.getReady();
      expect(ready.map((t) => t.id)).toContain('task-002');
    });

    it('should report isComplete when all done', () => {
      const queue = new TaskQueue([
        makeTask('task-001'),
        makeTask('task-002'),
      ]);

      expect(queue.isComplete()).toBe(false);

      queue.start('task-001');
      queue.complete('task-001');
      queue.start('task-002');
      queue.complete('task-002');

      expect(queue.isComplete()).toBe(true);
    });

    it('should throw on unknown task operations', () => {
      const queue = new TaskQueue([makeTask('task-001')]);
      expect(() => queue.start('task-999')).toThrow('Unknown task');
      expect(() => queue.complete('task-999')).toThrow('Unknown task');
      expect(() => queue.markBlocked('task-999')).toThrow('Unknown task');
    });
  });

  describe('restoreState', () => {
    it('should restore completed and blocked tasks', () => {
      const queue = new TaskQueue([
        makeTask('task-001'),
        makeTask('task-002', ['task-001']),
        makeTask('task-003', ['task-001']),
      ]);

      queue.restoreState(['task-001'], ['task-003']);

      expect(queue.isTaskCompleted('task-001')).toBe(true);
      expect(queue.getCounts().blocked).toBe(1);
      expect(queue.getCounts().completed).toBe(1);

      const ready = queue.getReady();
      expect(ready.map((t) => t.id)).toContain('task-002');
    });
  });

  describe('topologicalSort', () => {
    it('should return tasks in dependency order', () => {
      const queue = new TaskQueue([
        makeTask('task-003', ['task-002']),
        makeTask('task-001'),
        makeTask('task-002', ['task-001']),
      ]);

      const sorted = queue.topologicalSort();
      const ids = sorted.map((t) => t.id);
      expect(ids.indexOf('task-001')).toBeLessThan(ids.indexOf('task-002'));
      expect(ids.indexOf('task-002')).toBeLessThan(ids.indexOf('task-003'));
    });
  });

  describe('detectBatchCollisions', () => {
    it('should return empty array when no tasks share a file', () => {
      const tasks = [
        makeTask('task-001', [], ['src/a.ts']),
        makeTask('task-002', [], ['src/b.ts']),
        makeTask('task-003', [], ['src/c.ts']),
      ];

      const collisions = TaskQueue.detectBatchCollisions(tasks);
      expect(collisions).toEqual([]);
    });

    it('should return one collision entry for a pair sharing a file', () => {
      const tasks = [
        makeTask('task-001', [], ['src/a.ts']),
        makeTask('task-002', [], ['src/a.ts']),
      ];

      const collisions = TaskQueue.detectBatchCollisions(tasks);
      expect(collisions).toHaveLength(1);
      expect(collisions[0]).toContain('src/a.ts');
      expect(collisions[0]).toContain('task-001');
      expect(collisions[0]).toContain('task-002');
    });

    it('should return separate entries for multiple colliding pairs', () => {
      const tasks = [
        makeTask('task-001', [], ['src/a.ts', 'src/b.ts']),
        makeTask('task-002', [], ['src/a.ts']),
        makeTask('task-003', [], ['src/b.ts']),
      ];

      const collisions = TaskQueue.detectBatchCollisions(tasks);
      expect(collisions).toHaveLength(2);
      const combined = collisions.join('\n');
      expect(combined).toContain('src/a.ts');
      expect(combined).toContain('src/b.ts');
    });

    it('should return three entries for three tasks sharing the same file', () => {
      const tasks = [
        makeTask('task-001', [], ['src/shared.ts']),
        makeTask('task-002', [], ['src/shared.ts']),
        makeTask('task-003', [], ['src/shared.ts']),
      ];

      const collisions = TaskQueue.detectBatchCollisions(tasks);
      // Pairs: (001,002), (001,003), (002,003)
      expect(collisions).toHaveLength(3);
    });

    it('should return empty array for an empty task list', () => {
      const collisions = TaskQueue.detectBatchCollisions([]);
      expect(collisions).toEqual([]);
    });

    it('should not report a collision for a task that owns a file exclusively', () => {
      const tasks = [
        makeTask('task-001', [], ['src/a.ts', 'src/b.ts']),
        makeTask('task-002', [], ['src/b.ts']),
      ];

      const collisions = TaskQueue.detectBatchCollisions(tasks);
      expect(collisions).toHaveLength(1);
      expect(collisions[0]).toContain('src/b.ts');
      expect(collisions[0]).not.toContain('src/a.ts');
    });
  });

  describe('selectNonOverlappingBatch', () => {
    it('should select tasks with non-overlapping files', () => {
      const tasks = [
        makeTask('task-001', [], ['src/a.ts']),
        makeTask('task-002', [], ['src/b.ts']),
        makeTask('task-003', [], ['src/a.ts']), // overlaps with task-001
      ];

      const batch = TaskQueue.selectNonOverlappingBatch(tasks, 10);
      const batchIds = batch.map((t) => t.id);

      expect(batchIds).toContain('task-001');
      expect(batchIds).toContain('task-002');
      expect(batchIds).not.toContain('task-003');
    });

    it('should respect max batch size', () => {
      const tasks = [
        makeTask('task-001', [], ['src/a.ts']),
        makeTask('task-002', [], ['src/b.ts']),
        makeTask('task-003', [], ['src/c.ts']),
      ];

      const batch = TaskQueue.selectNonOverlappingBatch(tasks, 2);
      expect(batch.length).toBe(2);
    });

    it('should handle empty input', () => {
      const batch = TaskQueue.selectNonOverlappingBatch([], 5);
      expect(batch.length).toBe(0);
    });
  });
});
