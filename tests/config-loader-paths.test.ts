import { describe, it, expect, vi, beforeEach } from 'vitest';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';

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

/** Minimal valid config fixture. stateDir is set to a known absolute path by default. */
function makeConfig(overrides: Record<string, unknown> = {}) {
  return {
    projectName: 'test-project',
    repository: 'owner/repo',
    repoPath: '/tmp/repo',
    baseBranch: 'main',
    issues: { ids: [1] },
    stateDir: '/abs/state',
    copilot: {
      cliCommand: 'gh copilot',
      model: 'claude-sonnet-4.6',
      agentDir: 'agents', // default bare name
      timeout: 300_000,
    },
    ...overrides,
  };
}

/** Set up file-system mocks for a given config object. */
function setupFs(config: object) {
  mockExists.mockImplementation(async (p: string) => {
    // .git always exists (valid repo), config file always exists
    return true;
  });
  mockReadFile.mockResolvedValue(JSON.stringify(config) as unknown as Buffer);
}

describe('loadConfig – resolveAgentDir branches', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns an absolute agentDir unchanged', async () => {
    setupFs(makeConfig({
      copilot: {
        cliCommand: 'gh copilot',
        model: 'claude-sonnet-4.6',
        agentDir: '/absolute/path/agents',
        timeout: 300_000,
      },
    }));

    const config = await loadConfig('/tmp/cadre.config.json');
    expect(config.copilot.agentDir).toBe('/absolute/path/agents');
  });

  it('resolves a .cadre/-prefixed agentDir under stateDir (strips prefix)', async () => {
    setupFs(makeConfig({
      copilot: {
        cliCommand: 'gh copilot',
        model: 'claude-sonnet-4.6',
        agentDir: '.cadre/my-agents',
        timeout: 300_000,
      },
    }));

    const config = await loadConfig('/tmp/cadre.config.json');
    expect(config.copilot.agentDir).toBe('/abs/state/my-agents');
  });

  it('resolves a .claude/-prefixed agentDir under stateDir (strips prefix)', async () => {
    setupFs(makeConfig({
      copilot: {
        cliCommand: 'gh copilot',
        model: 'claude-sonnet-4.6',
        agentDir: '.claude/agents',
        timeout: 300_000,
      },
    }));

    const config = await loadConfig('/tmp/cadre.config.json');
    expect(config.copilot.agentDir).toBe('/abs/state/agents');
  });

  it('resolves a bare name (no /) under stateDir', async () => {
    setupFs(makeConfig({
      copilot: {
        cliCommand: 'gh copilot',
        model: 'claude-sonnet-4.6',
        agentDir: 'agents',
        timeout: 300_000,
      },
    }));

    const config = await loadConfig('/tmp/cadre.config.json');
    expect(config.copilot.agentDir).toBe('/abs/state/agents');
  });

  it('resolves a repo-relative path (contains / but not .cadre/ or .claude/) under repoPath', async () => {
    setupFs(makeConfig({
      copilot: {
        cliCommand: 'gh copilot',
        model: 'claude-sonnet-4.6',
        agentDir: '.github/agents',
        timeout: 300_000,
      },
    }));

    const config = await loadConfig('/tmp/cadre.config.json');
    expect(config.copilot.agentDir).toBe('/tmp/repo/.github/agents');
  });
});

describe('loadConfig – agent field handling', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('synthesizes agent from copilot fields when config.agent is absent', async () => {
    setupFs(makeConfig());
    const config = await loadConfig('/tmp/cadre.config.json');
    expect(config.agent).toBeDefined();
    expect(config.agent.backend).toBe('copilot');
  });

  it('uses config.agent verbatim when it is present', async () => {
    setupFs(makeConfig({
      agent: {
        backend: 'claude',
        model: 'claude-opus-4.5',
        timeout: 60_000,
        copilot: { cliCommand: 'gh copilot', agentDir: '/abs/state/agents' },
        claude: { cliCommand: '/usr/local/bin/claude', agentDir: '/abs/state/agents' },
      },
    }));

    const config = await loadConfig('/tmp/cadre.config.json');
    expect(config.agent.backend).toBe('claude');
    expect(config.agent.model).toBe('claude-opus-4.5');
  });
});

describe('loadConfig – stateDir resolution', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('defaults stateDir to ~/.cadre/<projectName> when absent from config', async () => {
    const cfg = makeConfig();
    // Remove stateDir
    delete (cfg as Record<string, unknown>).stateDir;
    setupFs(cfg);

    const config = await loadConfig('/tmp/cadre.config.json');
    const expected = join(homedir(), '.cadre', 'test-project');
    expect(config.stateDir).toBe(expected);
  });

  it('uses stateDir verbatim when it is an absolute path', async () => {
    setupFs(makeConfig({ stateDir: '/custom/absolute/state' }));

    const config = await loadConfig('/tmp/cadre.config.json');
    expect(config.stateDir).toBe('/custom/absolute/state');
  });

  it('resolves a relative stateDir against process.cwd()', async () => {
    setupFs(makeConfig({ stateDir: 'relative/state' }));

    const config = await loadConfig('/tmp/cadre.config.json');
    expect(config.stateDir).toBe(resolve(process.cwd(), 'relative/state'));
  });
});

describe('loadConfig – worktreeRoot resolution', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('defaults worktreeRoot to <stateDir>/worktrees when absent from config', async () => {
    const cfg = makeConfig({ stateDir: '/abs/state' });
    // Ensure no worktreeRoot
    delete (cfg as Record<string, unknown>).worktreeRoot;
    setupFs(cfg);

    const config = await loadConfig('/tmp/cadre.config.json');
    expect(config.worktreeRoot).toBe('/abs/state/worktrees');
  });

  it('uses worktreeRoot verbatim when it is an absolute path', async () => {
    setupFs(makeConfig({ worktreeRoot: '/custom/worktrees' }));

    const config = await loadConfig('/tmp/cadre.config.json');
    expect(config.worktreeRoot).toBe('/custom/worktrees');
  });

  it('resolves a relative worktreeRoot against repoPath', async () => {
    setupFs(makeConfig({ worktreeRoot: 'relative/worktrees' }));

    const config = await loadConfig('/tmp/cadre.config.json');
    // repoPath is /tmp/repo (absolute in fixture)
    expect(config.worktreeRoot).toBe('/tmp/repo/relative/worktrees');
  });

  it('worktreeRoot defaults to stateDir/worktrees using the default stateDir when both are absent', async () => {
    const cfg = makeConfig();
    delete (cfg as Record<string, unknown>).stateDir;
    delete (cfg as Record<string, unknown>).worktreeRoot;
    setupFs(cfg);

    const config = await loadConfig('/tmp/cadre.config.json');
    const expectedStateDir = join(homedir(), '.cadre', 'test-project');
    expect(config.worktreeRoot).toBe(join(expectedStateDir, 'worktrees'));
  });
});
