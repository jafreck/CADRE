import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CommitManager } from '../src/git/commit.js';
import { Logger } from '../src/logging/logger.js';
import type { CadreConfig } from '../src/config/schema.js';

// Mock simple-git
vi.mock('simple-git', () => {
  const mockGit = {
    add: vi.fn().mockResolvedValue(undefined),
    commit: vi.fn().mockResolvedValue({ commit: 'abc123' }),
    push: vi.fn().mockResolvedValue(undefined),
    diff: vi.fn().mockResolvedValue(''),
    status: vi.fn().mockResolvedValue({ isClean: () => true, files: [] }),
    reset: vi.fn().mockResolvedValue(undefined),
    raw: vi.fn().mockResolvedValue(''),
    revparse: vi.fn().mockResolvedValue('abc123'),
    log: vi.fn().mockResolvedValue({ latest: { hash: 'abc123' } }),
  };
  return {
    simpleGit: vi.fn(() => mockGit),
    default: vi.fn(() => mockGit),
  };
});

describe('CommitManager', () => {
  let manager: CommitManager;
  let mockLogger: Logger;

  beforeEach(() => {
    mockLogger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    } as unknown as Logger;

    const mockCommitConfig = {
      conventional: true,
      sign: false,
      commitPerPhase: true,
      squashBeforePR: false,
    } as CadreConfig['commits'];

    manager = new CommitManager('/tmp/worktree', mockCommitConfig, mockLogger);
  });

  it('should be constructable', () => {
    expect(manager).toBeDefined();
  });

  it('should have commit method', () => {
    expect(typeof manager.commit).toBe('function');
  });

  it('should have commitFiles method', () => {
    expect(typeof manager.commitFiles).toBe('function');
  });

  it('should have push method', () => {
    expect(typeof manager.push).toBe('function');
  });

  it('should have squash method', () => {
    expect(typeof manager.squash).toBe('function');
  });

  it('should have getChangedFiles method', () => {
    expect(typeof manager.getChangedFiles).toBe('function');
  });

  it('should have isClean method', () => {
    expect(typeof manager.isClean).toBe('function');
  });

  it('should have getDiff method', () => {
    expect(typeof manager.getDiff).toBe('function');
  });
});
