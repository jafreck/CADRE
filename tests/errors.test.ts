import { describe, it, expect } from 'vitest';
import {
  BudgetExceededError,
  PhaseFailedError,
  AgentTimeoutError,
  SchemaValidationError,
} from '../src/errors.js';

describe('BudgetExceededError', () => {
  it('instantiates with correct name, message, and properties', () => {
    const err = new BudgetExceededError('budget exceeded', 150, 100);
    expect(err.name).toBe('BudgetExceededError');
    expect(err.message).toBe('budget exceeded');
    expect(err.current).toBe(150);
    expect(err.budget).toBe(100);
    expect(err instanceof Error).toBe(true);
  });

  it('is an instance of BudgetExceededError', () => {
    const err = new BudgetExceededError('over budget', 200, 100);
    expect(err instanceof BudgetExceededError).toBe(true);
  });

  it('has a stack trace', () => {
    const err = new BudgetExceededError('over budget', 200, 100);
    expect(err.stack).toBeDefined();
  });

  it('handles zero values for current and budget', () => {
    const err = new BudgetExceededError('zero budget', 0, 0);
    expect(err.current).toBe(0);
    expect(err.budget).toBe(0);
  });

  it('handles current equal to budget', () => {
    const err = new BudgetExceededError('at limit', 100, 100);
    expect(err.current).toBe(100);
    expect(err.budget).toBe(100);
  });

  it('can be caught as a generic Error', () => {
    const throwIt = () => { throw new BudgetExceededError('over budget', 200, 100); };
    expect(throwIt).toThrowError('over budget');
  });
});

describe('PhaseFailedError', () => {
  it('instantiates with correct name, message, and properties', () => {
    const err = new PhaseFailedError('phase failed', 2, 'analysis');
    expect(err.name).toBe('PhaseFailedError');
    expect(err.message).toBe('phase failed');
    expect(err.phase).toBe(2);
    expect(err.phaseName).toBe('analysis');
    expect(err instanceof Error).toBe(true);
  });

  it('is an instance of PhaseFailedError', () => {
    const err = new PhaseFailedError('phase failed', 1, 'planning');
    expect(err instanceof PhaseFailedError).toBe(true);
  });

  it('has a stack trace', () => {
    const err = new PhaseFailedError('phase failed', 1, 'planning');
    expect(err.stack).toBeDefined();
  });

  it('handles phase 0', () => {
    const err = new PhaseFailedError('phase failed', 0, 'init');
    expect(err.phase).toBe(0);
    expect(err.phaseName).toBe('init');
  });

  it('can be caught as a generic Error', () => {
    const throwIt = () => { throw new PhaseFailedError('phase failed', 2, 'analysis'); };
    expect(throwIt).toThrowError('phase failed');
  });
});

describe('AgentTimeoutError', () => {
  it('instantiates with correct name, message, and properties', () => {
    const err = new AgentTimeoutError('agent timed out', 'code-writer', 30000);
    expect(err.name).toBe('AgentTimeoutError');
    expect(err.message).toBe('agent timed out');
    expect(err.agent).toBe('code-writer');
    expect(err.timeoutMs).toBe(30000);
    expect(err instanceof Error).toBe(true);
  });

  it('is an instance of AgentTimeoutError', () => {
    const err = new AgentTimeoutError('timed out', 'test-writer', 5000);
    expect(err instanceof AgentTimeoutError).toBe(true);
  });

  it('has a stack trace', () => {
    const err = new AgentTimeoutError('timed out', 'test-writer', 5000);
    expect(err.stack).toBeDefined();
  });

  it('handles zero timeoutMs', () => {
    const err = new AgentTimeoutError('immediate timeout', 'agent', 0);
    expect(err.timeoutMs).toBe(0);
  });

  it('handles empty agent string', () => {
    const err = new AgentTimeoutError('timed out', '', 1000);
    expect(err.agent).toBe('');
  });

  it('can be caught as a generic Error', () => {
    const throwIt = () => { throw new AgentTimeoutError('agent timed out', 'code-writer', 30000); };
    expect(throwIt).toThrowError('agent timed out');
  });
});

describe('SchemaValidationError', () => {
  it('instantiates with correct name, message, and properties', () => {
    const err = new SchemaValidationError('invalid field', 'taskId', 42);
    expect(err.name).toBe('SchemaValidationError');
    expect(err.message).toBe('invalid field');
    expect(err.field).toBe('taskId');
    expect(err.received).toBe(42);
    expect(err instanceof Error).toBe(true);
  });

  it('is an instance of SchemaValidationError', () => {
    const err = new SchemaValidationError('invalid field', 'taskId', 42);
    expect(err instanceof SchemaValidationError).toBe(true);
  });

  it('has a stack trace', () => {
    const err = new SchemaValidationError('invalid field', 'taskId', 42);
    expect(err.stack).toBeDefined();
  });

  it('accepts null as received', () => {
    const err = new SchemaValidationError('null value', 'field', null);
    expect(err.received).toBeNull();
  });

  it('accepts undefined as received', () => {
    const err = new SchemaValidationError('undefined value', 'field', undefined);
    expect(err.received).toBeUndefined();
  });

  it('accepts an object as received', () => {
    const obj = { key: 'value' };
    const err = new SchemaValidationError('wrong type', 'payload', obj);
    expect(err.received).toBe(obj);
  });

  it('accepts a string as received', () => {
    const err = new SchemaValidationError('wrong type', 'count', 'not-a-number');
    expect(err.received).toBe('not-a-number');
  });

  it('can be caught as a generic Error', () => {
    const throwIt = () => { throw new SchemaValidationError('invalid field', 'taskId', 42); };
    expect(throwIt).toThrowError('invalid field');
  });
});
