import { describe, it, expect } from 'vitest';

describe('@inquirer/prompts dependency', () => {
  it('should be importable as a module', async () => {
    const mod = await import('@inquirer/prompts');
    expect(mod).toBeDefined();
  });

  it('should export core prompt functions', async () => {
    const { input, confirm, select } = await import('@inquirer/prompts');
    expect(typeof input).toBe('function');
    expect(typeof confirm).toBe('function');
    expect(typeof select).toBe('function');
  });
});
