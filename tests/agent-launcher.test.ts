import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { AgentLauncher } from '../src/core/agent-launcher.js';
import { AGENT_DEFINITIONS } from '../src/agents/types.js';
import { Logger } from '../src/logging/logger.js';
import type { CadreConfig } from '../src/config/schema.js';
import type { AgentInvocation, TokenUsageDetail } from '../src/agents/types.js';
import type { ProcessResult } from '../src/util/process.js';

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

describe('AgentLauncher.parseTokenUsage', () => {
  let launcher: AgentLauncher;

  function makeResult(stdout: string, stderr: string = ''): ProcessResult {
    return { exitCode: 0, stdout, stderr, signal: null, timedOut: false };
  }

  beforeEach(() => {
    const mockLogger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    } as unknown as Logger;

    const mockConfig = {
      projectName: 'test-project',
      repository: 'owner/repo',
      repoPath: '/tmp/repo',
      baseBranch: 'main',
      issues: { ids: [42] },
      copilot: { cliCommand: 'copilot', agentDir: '.github/agents', timeout: 300000 },
      environment: { inheritShellPath: true, extraPath: [] },
    } as CadreConfig;

    launcher = new AgentLauncher(mockConfig, mockLogger);
  });

  it('should return TokenUsageDetail when structured cadre_tokens block is present in stdout', () => {
    const result = makeResult('{"cadre_tokens": {"input": 1000, "output": 200, "model": "claude-sonnet-4.6"}}');
    const usage = (launcher as unknown as { parseTokenUsage(r: ProcessResult): TokenUsageDetail | number }).parseTokenUsage(result);
    expect(usage).toEqual({ input: 1000, output: 200, model: 'claude-sonnet-4.6' });
  });

  it('should return TokenUsageDetail when structured block is present in stderr', () => {
    const result = makeResult('', '{"cadre_tokens": {"input": 500, "output": 100, "model": "gpt-4"}}');
    const usage = (launcher as unknown as { parseTokenUsage(r: ProcessResult): TokenUsageDetail | number }).parseTokenUsage(result);
    expect(usage).toEqual({ input: 500, output: 100, model: 'gpt-4' });
  });

  it('should return TokenUsageDetail when structured block appears anywhere in combined output', () => {
    const result = makeResult('Some preamble text\n{"cadre_tokens": {"input": 300, "output": 50, "model": "claude-haiku"}}\nTrailing text');
    const usage = (launcher as unknown as { parseTokenUsage(r: ProcessResult): TokenUsageDetail | number }).parseTokenUsage(result);
    expect(usage).toEqual({ input: 300, output: 50, model: 'claude-haiku' });
  });

  it('should fall back to regex pattern when no structured block is present', () => {
    const result = makeResult('total tokens: 1,500 processed');
    const usage = (launcher as unknown as { parseTokenUsage(r: ProcessResult): TokenUsageDetail | number }).parseTokenUsage(result);
    expect(usage).toBe(1500);
  });

  it('should return 0 when neither structured block nor regex pattern matches', () => {
    const result = makeResult('Agent completed successfully.');
    const usage = (launcher as unknown as { parseTokenUsage(r: ProcessResult): TokenUsageDetail | number }).parseTokenUsage(result);
    expect(usage).toBe(0);
  });

  it('should fall through to regex when JSON in structured block is malformed', () => {
    const result = makeResult('{"cadre_tokens": {invalid json}}\ntokens used: 800');
    const usage = (launcher as unknown as { parseTokenUsage(r: ProcessResult): TokenUsageDetail | number }).parseTokenUsage(result);
    expect(usage).toBe(800);
  });

  it('should fall through to regex when structured block is missing required fields', () => {
    // model field is missing — should not return TokenUsageDetail
    const result = makeResult('{"cadre_tokens": {"input": 100, "output": 50}}\ntokens used: 200');
    const usage = (launcher as unknown as { parseTokenUsage(r: ProcessResult): TokenUsageDetail | number }).parseTokenUsage(result);
    expect(usage).toBe(200);
  });

  it('should fall through to regex when input is not a number', () => {
    const result = makeResult('{"cadre_tokens": {"input": "many", "output": 50, "model": "x"}}\ntokens used: 300');
    const usage = (launcher as unknown as { parseTokenUsage(r: ProcessResult): TokenUsageDetail | number }).parseTokenUsage(result);
    expect(usage).toBe(300);
  });

  it('should match tokens_used regex pattern', () => {
    const result = makeResult('tokens_used: 2500');
    const usage = (launcher as unknown as { parseTokenUsage(r: ProcessResult): TokenUsageDetail | number }).parseTokenUsage(result);
    expect(usage).toBe(2500);
  });

  it('should match usage N tokens regex pattern', () => {
    const result = makeResult('usage: 750 tokens');
    const usage = (launcher as unknown as { parseTokenUsage(r: ProcessResult): TokenUsageDetail | number }).parseTokenUsage(result);
    expect(usage).toBe(750);
  });

  it('should prefer structured block over regex when both are present', () => {
    const result = makeResult('total tokens: 9999\n{"cadre_tokens": {"input": 100, "output": 50, "model": "claude-opus"}}');
    const usage = (launcher as unknown as { parseTokenUsage(r: ProcessResult): TokenUsageDetail | number }).parseTokenUsage(result);
    expect(usage).toEqual({ input: 100, output: 50, model: 'claude-opus' });
  });
});
