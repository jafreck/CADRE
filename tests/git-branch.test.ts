import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BranchManager } from '../src/git/branch.js';
import { Logger } from '../src/logging/logger.js';

// Mock simple-git
vi.mock('simple-git', () => {
  const mockGit = {
    branch: vi.fn(),
    branchLocal: vi.fn(),
    checkout: vi.fn(),
    deleteLocalBranch: vi.fn(),
    push: vi.fn(),
    raw: vi.fn(),
    revparse: vi.fn(),
    listRemote: vi.fn(),
  };
  return {
    simpleGit: vi.fn(() => mockGit),
    default: vi.fn(() => mockGit),
  };
});

describe('BranchManager', () => {
  let manager: BranchManager;
  let mockLogger: Logger;

  beforeEach(() => {
    mockLogger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    } as unknown as Logger;
    manager = new BranchManager('/tmp/repo', mockLogger);
  });

  it('should be constructable', () => {
    expect(manager).toBeDefined();
  });

  // Basic structural tests — full integration tests require a real git repo
  it('should have create method', () => {
    expect(typeof manager.create).toBe('function');
  });

  it('should have deleteLocal method', () => {
    expect(typeof manager.deleteLocal).toBe('function');
  });

  it('should have existsLocal method', () => {
    expect(typeof manager.existsLocal).toBe('function');
  });

  it('should have existsRemote method', () => {
    expect(typeof manager.existsRemote).toBe('function');
  });

  it('should have getHead method', () => {
    expect(typeof manager.getHead).toBe('function');
  });
});
