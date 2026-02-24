import { describe, it, expect, vi, beforeEach } from 'vitest';
import { makeRuntimeConfig } from './helpers/make-runtime-config.js';

vi.mock('../src/util/process.js', () => ({
  exec: vi.fn(),
}));

import { exec } from '../src/util/process.js';
import { commandValidator } from '../src/validation/command-validator.js';

const makeConfig = (
  overrides: Partial<{ build: string; test: string; install?: string; lint?: string }> = {},
) =>
  makeRuntimeConfig({
    commands: {
      build: overrides.build ?? 'npm run build',
      test: overrides.test ?? 'npx vitest run',
      ...(overrides.install !== undefined ? { install: overrides.install } : {}),
      ...(overrides.lint !== undefined ? { lint: overrides.lint } : {}),
    },
  });

const ok = { exitCode: 0, stdout: '', stderr: '', signal: null, timedOut: false } as const;
const fail = { exitCode: 1, stdout: '', stderr: '', signal: null, timedOut: false } as const;

describe('validation-command', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('returns passed:false when a required executable is not found on PATH', async () => {
    vi.mocked(exec)
      .mockResolvedValueOnce({ ...fail }) // build missing
      .mockResolvedValue({ ...ok });

    const result = await commandValidator.validate(makeConfig({ build: 'missing-tool build' }));

    expect(result.passed).toBe(false);
    expect(result.errors.some((e) => e.includes('missing-tool') && e.includes('commands.build'))).toBe(true);
  });

  it('does not add an error when an optional command is unconfigured', async () => {
    vi.mocked(exec).mockResolvedValue({ ...ok });

    // install and lint are not set; only build and test are checked
    const result = await commandValidator.validate(makeConfig());

    expect(result.passed).toBe(true);
    expect(result.errors).toHaveLength(0);
    // Only 2 calls: build + test executables
    expect(vi.mocked(exec).mock.calls).toHaveLength(2);
  });

  it('returns passed:true when all configured executables are found on PATH', async () => {
    vi.mocked(exec).mockResolvedValue({ ...ok });

    const result = await commandValidator.validate(makeConfig({ install: 'npm install', lint: 'eslint .' }));

    expect(result.passed).toBe(true);
    expect(result.errors).toHaveLength(0);
  });
});
