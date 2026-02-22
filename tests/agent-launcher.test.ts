import { describe, it, expect, vi, beforeEach } from 'vitest';
import { AgentLauncher } from '../src/core/agent-launcher.js';
import { Logger } from '../src/logging/logger.js';
import type { CadreConfig } from '../src/config/schema.js';
import type { AgentInvocation } from '../src/agents/types.js';

describe('AgentLauncher', () => {
  let mockLogger: Logger;
  let mockConfig: CadreConfig;

  beforeEach(() => {
    mockLogger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      child: vi.fn().mockReturnValue({
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      }),
      agentLogger: vi.fn().mockReturnValue({
        debug: vi.fn(),
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      }),
    } as unknown as Logger;

    mockConfig = {
      projectName: 'test-project',
      repository: 'owner/repo',
      repoPath: '/tmp/repo',
      baseBranch: 'main',
      issues: { ids: [42] },
      copilot: {
        cliCommand: 'copilot',
        agentDir: '.github/agents',
        timeout: 300000,
      },
      environment: {
        inheritShellPath: true,
        extraPath: [],
      },
    } as CadreConfig;
  });

  it('should be constructable', () => {
    const launcher = new AgentLauncher(mockConfig, mockLogger);
    expect(launcher).toBeDefined();
  });

  it('should have init method', () => {
    const launcher = new AgentLauncher(mockConfig, mockLogger);
    expect(typeof launcher.init).toBe('function');
  });

  it('should have launchAgent method', () => {
    const launcher = new AgentLauncher(mockConfig, mockLogger);
    expect(typeof launcher.launchAgent).toBe('function');
  });
});
