import { describe, it, expect } from 'vitest';
import { implementationTaskSchema, implementationPlanSchema } from '../../src/agents/schemas/index.js';

const makeValidSession = (id = 'session-001') => ({
  id,
  name: 'Add feature',
  rationale: 'Needed for productivity',
  dependencies: [],
  steps: [{
    id: `${id}-step-001`,
    name: 'Add feature step',
    description: 'Detailed description',
    files: ['src/feature.ts'],
    complexity: 'simple',
    acceptanceCriteria: ['Should work'],
  }],
});

describe('implementationTaskSchema', () => {
  const validTask = makeValidSession();

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
    const invalid = { ...validTask, steps: [{ ...validTask.steps[0], complexity: 'extreme' }] };
    const result = implementationTaskSchema.safeParse(invalid);
    expect(result.success).toBe(false);
  });

  it('should reject when acceptanceCriteria field is missing', () => {
    const { acceptanceCriteria: _a, ...withoutAc } = validTask.steps[0];
    const invalid = { ...validTask, steps: [withoutAc] };
    const result = implementationTaskSchema.safeParse(invalid);
    expect(result.success).toBe(false);
  });

  it('should accept all valid complexity values', () => {
    const complexities = ['simple', 'moderate', 'complex'];
    for (const complexity of complexities) {
      const valid = { ...validTask, steps: [{ ...validTask.steps[0], complexity }] };
      const result = implementationTaskSchema.safeParse(valid);
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

  it('should default testable to true when omitted', () => {
    const result = implementationTaskSchema.safeParse(validTask);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.testable).toBe(true);
    }
  });

  it('should accept testable: false', () => {
    const result = implementationTaskSchema.safeParse({ ...validTask, testable: false });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.testable).toBe(false);
    }
  });
});

describe('implementationPlanSchema', () => {
  const validTask = makeValidSession();

  it('should accept an empty plan array', () => {
    const result = implementationPlanSchema.safeParse([]);
    expect(result.success).toBe(true);
  });

  it('should accept a plan with multiple valid tasks', () => {
    const result = implementationPlanSchema.safeParse([
      validTask,
      makeValidSession('session-002'),
    ]);
    expect(result.success).toBe(true);
  });

  it('should reject a plan containing an invalid task', () => {
    const invalid = { ...validTask, steps: [{ ...validTask.steps[0], complexity: 'invalid' }] };
    const result = implementationPlanSchema.safeParse([invalid]);
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
