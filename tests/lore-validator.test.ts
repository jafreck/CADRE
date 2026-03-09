import { describe, it, expect, vi, beforeEach } from 'vitest';
import { makeRuntimeConfig } from './helpers/make-runtime-config.js';

vi.mock('../src/util/process.js', () => ({
  exec: vi.fn(),
}));

import { exec } from '../src/util/process.js';
import { loreValidator } from '../src/validation/lore-validator.js';

describe('loreValidator', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('should pass when lore is not enabled', async () => {
    const config = makeRuntimeConfig();
    const result = await loreValidator.validate(config);
    expect(result.passed).toBe(true);
    expect(result.warnings).toHaveLength(0);
    expect(exec).not.toHaveBeenCalled();
  });

  it('should pass when lore is enabled and command exists on PATH', async () => {
    vi.mocked(exec).mockResolvedValue({
      exitCode: 0,
      stdout: '/usr/local/bin/lore\n',
      stderr: '',
      signal: null,
      timedOut: false,
    });

    const config = makeRuntimeConfig({
      lore: {
        enabled: true,
        command: 'lore',
        indexArgs: [],
        serveArgs: ['mcp'],
        indexTimeout: 120_000,
      },
    } as any);

    const result = await loreValidator.validate(config);
    expect(result.passed).toBe(true);
    expect(result.warnings).toHaveLength(0);
  });

  it('should warn (not error) when lore is enabled but command not found', async () => {
    vi.mocked(exec).mockResolvedValue({
      exitCode: 1,
      stdout: '',
      stderr: 'lore not found',
      signal: null,
      timedOut: false,
    });

    const config = makeRuntimeConfig({
      lore: {
        enabled: true,
        command: 'lore',
        indexArgs: [],
        serveArgs: ['mcp'],
        indexTimeout: 120_000,
      },
    } as any);

    const result = await loreValidator.validate(config);
    // Lore is optional — warn but always pass
    expect(result.passed).toBe(true);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('lore');
    expect(result.errors).toHaveLength(0);
  });

  it('should check the custom command when configured', async () => {
    vi.mocked(exec).mockResolvedValue({
      exitCode: 0,
      stdout: '/usr/local/bin/my-lore\n',
      stderr: '',
      signal: null,
      timedOut: false,
    });

    const config = makeRuntimeConfig({
      lore: {
        enabled: true,
        command: 'my-lore',
        indexArgs: [],
        serveArgs: ['mcp'],
        indexTimeout: 120_000,
      },
    } as any);

    await loreValidator.validate(config);
    expect(exec).toHaveBeenCalledWith('which', ['my-lore']);
  });
});
