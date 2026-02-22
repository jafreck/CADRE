import { describe, it, expect } from 'vitest';

describe('@inquirer/prompts', () => {
  it('should export input prompt', async () => {
    const { input } = await import('@inquirer/prompts');
    expect(typeof input).toBe('function');
  });

  it('should export select prompt', async () => {
    const { select } = await import('@inquirer/prompts');
    expect(typeof select).toBe('function');
  });

  it('should export confirm prompt', async () => {
    const { confirm } = await import('@inquirer/prompts');
    expect(typeof confirm).toBe('function');
  });

  it('should export checkbox prompt', async () => {
    const { checkbox } = await import('@inquirer/prompts');
    expect(typeof checkbox).toBe('function');
  });
});
