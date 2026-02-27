import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { StaleStateError, RuntimeInterruptedError } from '../../src/errors.js';
import { ConfigLoadError } from '../../src/config/loader.js';
import { handleCommandError, withCommandHandler } from '../../src/cli/command-error-handler.js';

vi.mock('chalk', () => ({
  default: {
    red: (s: string) => s,
    yellow: (s: string) => s,
  },
}));

describe('handleCommandError', () => {
  let exitMock: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    exitMock = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should print conflict details and exit 1 for StaleStateError', () => {
    const conflicts = new Map([
      [
        42,
        [
          { kind: 'worktree' as const, description: 'Worktree already exists at /path' },
          { kind: 'branch' as const, description: 'Branch conflict' },
        ],
      ],
      [99, [{ kind: 'state' as const, description: 'Stale checkpoint' }]],
    ]);
    const err = new StaleStateError('stale', { hasConflicts: true, conflicts });

    handleCommandError(err);

    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Issue #42'));
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('[worktree]'));
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Worktree already exists'));
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('[branch]'));
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Issue #99'));
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('[state]'));
    expect(exitMock).toHaveBeenCalledWith(1);
  });

  it('should exit with the error exitCode for RuntimeInterruptedError', () => {
    const err = new RuntimeInterruptedError('interrupted', 'SIGINT', 130);

    handleCommandError(err);

    expect(exitMock).toHaveBeenCalledWith(130);
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('should exit with a different exitCode for RuntimeInterruptedError', () => {
    const err = new RuntimeInterruptedError('terminated', 'SIGTERM', 143);

    handleCommandError(err);

    expect(exitMock).toHaveBeenCalledWith(143);
  });

  it('should print config error message and exit 1 for ConfigLoadError', () => {
    const err = new ConfigLoadError('Config file not found at cadre.config.json');

    handleCommandError(err);

    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('Config file not found at cadre.config.json'),
    );
    expect(exitMock).toHaveBeenCalledWith(1);
  });

  it('should print generic Error message and exit 1 for unknown Error', () => {
    const err = new Error('something went wrong');

    handleCommandError(err);

    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('something went wrong'));
    expect(exitMock).toHaveBeenCalledWith(1);
  });

  it('should stringify non-Error values and exit 1', () => {
    handleCommandError('raw string error');

    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('raw string error'));
    expect(exitMock).toHaveBeenCalledWith(1);
  });

  it('should handle numeric non-Error value', () => {
    handleCommandError(404);

    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('404'));
    expect(exitMock).toHaveBeenCalledWith(1);
  });

  it('should handle StaleStateError with empty conflicts map', () => {
    const conflicts = new Map<number, Array<{ kind: string; description: string }>>([]);
    const err = new StaleStateError('stale', { hasConflicts: false, conflicts } as never);

    handleCommandError(err);

    expect(exitMock).toHaveBeenCalledWith(1);
  });
});

describe('withCommandHandler', () => {
  let exitMock: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    exitMock = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never);
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should call the wrapped function with the provided arguments', async () => {
    const fn = vi.fn().mockResolvedValue(undefined);
    const wrapped = withCommandHandler(fn);

    await wrapped('arg1', 42);

    expect(fn).toHaveBeenCalledWith('arg1', 42);
  });

  it('should not call handleCommandError when the function succeeds', async () => {
    const fn = vi.fn().mockResolvedValue(undefined);
    const wrapped = withCommandHandler(fn);

    await wrapped();

    expect(exitMock).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('should delegate to handleCommandError when the function throws', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('boom'));
    const wrapped = withCommandHandler(fn);

    await wrapped();

    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('boom'));
    expect(exitMock).toHaveBeenCalledWith(1);
  });

  it('should handle StaleStateError thrown from wrapped function', async () => {
    const conflicts = new Map([
      [7, [{ kind: 'worktree' as const, description: 'conflict desc' }]],
    ]);
    const fn = vi.fn().mockRejectedValue(
      new StaleStateError('stale', { hasConflicts: true, conflicts }),
    );
    const wrapped = withCommandHandler(fn);

    await wrapped();

    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('Issue #7'));
    expect(exitMock).toHaveBeenCalledWith(1);
  });

  it('should handle RuntimeInterruptedError thrown from wrapped function', async () => {
    const fn = vi.fn().mockRejectedValue(
      new RuntimeInterruptedError('sigint', 'SIGINT', 130),
    );
    const wrapped = withCommandHandler(fn);

    await wrapped();

    expect(exitMock).toHaveBeenCalledWith(130);
  });

  it('should handle ConfigLoadError thrown from wrapped function', async () => {
    const fn = vi.fn().mockRejectedValue(new ConfigLoadError('bad config'));
    const wrapped = withCommandHandler(fn);

    await wrapped();

    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining('bad config'));
    expect(exitMock).toHaveBeenCalledWith(1);
  });

  it('should preserve the return type as Promise<void>', async () => {
    const fn = vi.fn().mockResolvedValue(undefined);
    const wrapped = withCommandHandler(fn);
    const result = await wrapped();

    expect(result).toBeUndefined();
  });
});
