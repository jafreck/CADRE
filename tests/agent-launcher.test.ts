import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { AgentLauncher } from '../src/core/agent-launcher.js';
import { AGENT_DEFINITIONS } from '../src/agents/types.js';
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

describe('AgentLauncher.validateAgentFiles', () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = join(tmpdir(), `cadre-test-${Date.now()}`);
    await mkdir(tempDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it('should return empty array when all agent files exist and are non-empty', async () => {
    for (const agent of AGENT_DEFINITIONS) {
      await writeFile(join(tempDir, `${agent.name}.md`), `# ${agent.name}\nContent`);
    }
    const issues = await AgentLauncher.validateAgentFiles(tempDir);
    expect(issues).toEqual([]);
  });

  it('should report missing files when agent files do not exist', async () => {
    // Create all files except the first agent
    const [first, ...rest] = AGENT_DEFINITIONS;
    for (const agent of rest) {
      await writeFile(join(tempDir, `${agent.name}.md`), `# ${agent.name}\nContent`);
    }
    const issues = await AgentLauncher.validateAgentFiles(tempDir);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toContain('Missing');
    expect(issues[0]).toContain(`${first.name}.md`);
  });

  it('should report empty files', async () => {
    for (const agent of AGENT_DEFINITIONS) {
      await writeFile(join(tempDir, `${agent.name}.md`), `# ${agent.name}\nContent`);
    }
    // Overwrite the last agent's file with empty content
    const lastAgent = AGENT_DEFINITIONS[AGENT_DEFINITIONS.length - 1];
    await writeFile(join(tempDir, `${lastAgent.name}.md`), '');

    const issues = await AgentLauncher.validateAgentFiles(tempDir);
    expect(issues).toHaveLength(1);
    expect(issues[0]).toContain('Empty');
    expect(issues[0]).toContain(`${lastAgent.name}.md`);
  });

  it('should report multiple issues when several files are missing or empty', async () => {
    // Only create one file; all others will be missing
    const firstAgent = AGENT_DEFINITIONS[0];
    await writeFile(join(tempDir, `${firstAgent.name}.md`), `# ${firstAgent.name}\nContent`);

    const issues = await AgentLauncher.validateAgentFiles(tempDir);
    expect(issues.length).toBe(AGENT_DEFINITIONS.length - 1);
    for (const issue of issues) {
      expect(issue).toContain('Missing');
    }
  });

  it('should return empty array for an empty agent list directory that has all files', async () => {
    // Ensure validateAgentFiles resolves relative paths correctly
    for (const agent of AGENT_DEFINITIONS) {
      await writeFile(join(tempDir, `${agent.name}.md`), 'content');
    }
    const issues = await AgentLauncher.validateAgentFiles(tempDir);
    expect(Array.isArray(issues)).toBe(true);
    expect(issues).toHaveLength(0);
  });
});
