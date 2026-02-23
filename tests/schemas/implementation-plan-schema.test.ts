import { describe, it, expect } from 'vitest';
import { implementationTaskSchema, implementationPlanSchema } from '../../src/agents/schemas/index.js';

describe('implementationTaskSchema', () => {
  const validTask = {
    id: 'task-001',
    name: 'Add feature',
    description: 'Detailed description',
    files: ['src/feature.ts'],
    dependencies: [],
    complexity: 'simple',
    acceptanceCriteria: ['Should work'],
  };

  it('should accept a valid ImplementationTask', () => {
    const result = implementationTaskSchema.safeParse(validTask);
    expect(result.success).toBe(true);
  });

  it('should reject when id field is missing', () => {
    const { id: _i, ...without } = validTask;
    const result = implementationTaskSchema.safeParse(without);
    expect(result.success).toBe(false);
  });

  it('should reject an unknown complexity value', () => {
    const result = implementationTaskSchema.safeParse({ ...validTask, complexity: 'extreme' });
    expect(result.success).toBe(false);
  });

  it('should reject when acceptanceCriteria field is missing', () => {
    const { acceptanceCriteria: _a, ...without } = validTask;
    const result = implementationTaskSchema.safeParse(without);
    expect(result.success).toBe(false);
  });

  it('should accept all valid complexity values', () => {
    const complexities = ['simple', 'moderate', 'complex'];
    for (const complexity of complexities) {
      const result = implementationTaskSchema.safeParse({ ...validTask, complexity });
      expect(result.success).toBe(true);
    }
  });

  it('should strip unknown extra fields', () => {
    const result = implementationTaskSchema.safeParse({ ...validTask, unexpectedField: 'extra' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(Object.keys(result.data)).not.toContain('unexpectedField');
    }
  });
});

describe('implementationPlanSchema', () => {
  const validTask = {
    id: 'task-001',
    name: 'Add feature',
    description: 'Detailed description',
    files: ['src/feature.ts'],
    dependencies: [],
    complexity: 'simple',
    acceptanceCriteria: ['Should work'],
  };

  it('should accept an empty plan array', () => {
    const result = implementationPlanSchema.safeParse([]);
    expect(result.success).toBe(true);
  });

  it('should accept a plan with multiple valid tasks', () => {
    const result = implementationPlanSchema.safeParse([
      validTask,
      { ...validTask, id: 'task-002', name: 'Second task' },
    ]);
    expect(result.success).toBe(true);
  });

  it('should reject a plan containing an invalid task', () => {
    const result = implementationPlanSchema.safeParse([{ ...validTask, complexity: 'invalid' }]);
    expect(result.success).toBe(false);
  });

  it('should reject when a task is missing a required field', () => {
    const { name: _n, ...without } = validTask;
    const result = implementationPlanSchema.safeParse([without]);
    expect(result.success).toBe(false);
  });

  it('should strip unknown extra fields from tasks', () => {
    const result = implementationPlanSchema.safeParse([{ ...validTask, unexpectedField: 'extra' }]);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(Object.keys(result.data[0])).not.toContain('unexpectedField');
    }
  });
});
