import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/util/fs.js', () => ({
  exists: vi.fn(),
}));

vi.mock('node:fs/promises', () => ({
  readFile: vi.fn(),
}));

import { readFile } from 'node:fs/promises';
import { exists } from '../src/util/fs.js';
import { loadConfig } from '../src/config/loader.js';

const mockExists = vi.mocked(exists);
const mockReadFile = vi.mocked(readFile);

const BASE_CONFIG = {
  projectName: 'test-project',
  repository: 'owner/repo',
  repoPath: '/tmp/repo',
  baseBranch: 'main',
  issues: { ids: [1] },
  agent: {
    backend: 'copilot' as const,
    model: 'claude-sonnet-4.6',
    timeout: 300_000,
    copilot: {
      cliCommand: 'gh copilot',
      agentDir: '.github/agents',
    },
  },
};

function setupFs(config: object) {
  mockExists.mockImplementation(async (p: string) => {
    if (p.endsWith('.git')) return true;
    return true; // config file exists
  });
  mockReadFile.mockResolvedValue(JSON.stringify(config) as unknown as Buffer);
}

describe('loadConfig – agent configuration', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should preserve explicit agent.backend = "copilot"', async () => {
    setupFs(BASE_CONFIG);
    const config = await loadConfig('/tmp/repo/cadre.config.json');
    expect(config.agent).toBeDefined();
    expect(config.agent.backend).toBe('copilot');
  });

  it('should preserve explicit agent.copilot.cliCommand', async () => {
    setupFs(BASE_CONFIG);
    const config = await loadConfig('/tmp/repo/cadre.config.json');
    expect(config.agent.copilot.cliCommand).toBe('gh copilot');
  });

  it('should preserve explicit agent.model', async () => {
    setupFs(BASE_CONFIG);
    const config = await loadConfig('/tmp/repo/cadre.config.json');
    expect(config.agent.model).toBe('claude-sonnet-4.6');
  });

  it('should preserve explicit agent.timeout', async () => {
    setupFs(BASE_CONFIG);
    const config = await loadConfig('/tmp/repo/cadre.config.json');
    expect(config.agent.timeout).toBe(300_000);
  });

  it('should preserve explicit agent.backend = "claude" unchanged', async () => {
    setupFs({
      ...BASE_CONFIG,
      agent: { backend: 'claude', claude: { cliCommand: 'claude' } },
    });
    const config = await loadConfig('/tmp/repo/cadre.config.json');
    expect(config.agent.backend).toBe('claude');
  });

  it('should preserve explicit agent config entirely when agent key is present', async () => {
    const agentConfig = {
      backend: 'claude' as const,
      model: 'claude-opus-4.5',
      timeout: 60_000,
      claude: { cliCommand: '/usr/local/bin/claude' },
    };
    setupFs({ ...BASE_CONFIG, agent: agentConfig });
    const config = await loadConfig('/tmp/repo/cadre.config.json');
    expect(config.agent.backend).toBe('claude');
    expect(config.agent.model).toBe('claude-opus-4.5');
    expect(config.agent.timeout).toBe(60_000);
  });

  it('should preserve explicit copilot backend agent config unchanged', async () => {
    setupFs({
      ...BASE_CONFIG,
      agent: { backend: 'copilot', copilot: { cliCommand: 'custom-copilot' } },
    });
    const config = await loadConfig('/tmp/repo/cadre.config.json');
    expect(config.agent.backend).toBe('copilot');
    expect(config.agent.copilot.cliCommand).toBe('custom-copilot');
  });

  it('should normalize agent.copilot.agentDir', async () => {
    setupFs(BASE_CONFIG);
    const config = await loadConfig('/tmp/repo/cadre.config.json');
    expect(config.agent.copilot.agentDir).toBe('/tmp/repo/.github/agents');
  });

  it('should default agent config when omitted', async () => {
    const configWithoutAgent = { ...BASE_CONFIG } as Record<string, unknown>;
    delete configWithoutAgent.agent;
    setupFs(configWithoutAgent);
    const config = await loadConfig('/tmp/repo/cadre.config.json');
    expect(config.agent.backend).toBe('copilot');
    expect(config.agent.model).toBe('claude-sonnet-4.6');
    expect(config.agent.timeout).toBe(300_000);
  });

  it('should return a frozen config object', async () => {
    setupFs(BASE_CONFIG);
    const config = await loadConfig('/tmp/repo/cadre.config.json');
    expect(Object.isFrozen(config)).toBe(true);
  });

  it('should include isolation defaults in loaded config', async () => {
    setupFs(BASE_CONFIG);
    const config = await loadConfig('/tmp/repo/cadre.config.json');
    expect(config.isolation).toEqual({
      enabled: false,
      provider: 'host',
      policyProfile: 'default',
      allowFallbackToHost: false,
    });
  });

  it('should throw ConfigLoadError when config file does not exist', async () => {
    mockExists.mockResolvedValue(false);
    await expect(loadConfig('/nonexistent/cadre.config.json')).rejects.toThrow('Config file not found');
  });

  it('should throw ConfigLoadError on invalid JSON', async () => {
    mockExists.mockResolvedValue(true);
    mockReadFile.mockResolvedValue('not valid json' as unknown as Buffer);
    await expect(loadConfig('/tmp/repo/cadre.config.json')).rejects.toThrow('Failed to parse config file');
  });

  it('should throw ConfigLoadError when repoPath has no .git directory', async () => {
    mockExists.mockImplementation(async (p: string) => {
      if (p.endsWith('.git')) return false;
      return true;
    });
    mockReadFile.mockResolvedValue(JSON.stringify(BASE_CONFIG) as unknown as Buffer);
    await expect(loadConfig('/tmp/repo/cadre.config.json')).rejects.toThrow('not a git repository');
  });
});
