import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { CadreConfig } from '../src/config/schema.js';

vi.mock('../src/util/process.js', () => ({
  exec: vi.fn(),
}));

vi.mock('../src/util/fs.js', () => ({
  exists: vi.fn(),
}));

import { exec } from '../src/util/process.js';
import { exists } from '../src/util/fs.js';
import { agentBackendValidator } from '../src/validation/agent-backend-validator.js';

const makeConfig = (overrides: Partial<{ cliCommand: string; agentDir: string }> = {}): CadreConfig =>
  ({
    projectName: 'test-project',
    repository: 'owner/repo',
    repoPath: '/tmp/repo',
    baseBranch: 'main',
    issues: { ids: [1] },
    copilot: {
      cliCommand: overrides.cliCommand ?? 'copilot',
      agentDir: overrides.agentDir ?? '/tmp/agents',
      timeout: 300000,
    },
    // Mirrors what loadConfig always synthesizes
    agent: {
      backend: 'copilot' as const,
      copilot: { cliCommand: overrides.cliCommand ?? 'copilot', agentDir: overrides.agentDir ?? '/tmp/agents' },
      claude: { cliCommand: 'claude', agentDir: '.claude/agents' },
    },
  }) as unknown as CadreConfig;

const ok = { exitCode: 0, stdout: '/usr/local/bin/copilot', stderr: '', signal: null, timedOut: false } as const;
const fail = { exitCode: 1, stdout: '', stderr: 'not found', signal: null, timedOut: false } as const;

describe('validation-agent-backend', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('returns passed:false when CLI command is not on PATH', async () => {
    vi.mocked(exec).mockResolvedValue({ ...fail });
    vi.mocked(exists).mockResolvedValue(true);

    const result = await agentBackendValidator.validate(makeConfig({ cliCommand: 'missing-cli' }));

    expect(result.passed).toBe(false);
    expect(result.errors.some((e) => e.includes('missing-cli') && e.includes('PATH'))).toBe(true);
  });

  it('returns passed:false when agentDir does not exist', async () => {
    vi.mocked(exec).mockResolvedValue({ ...ok });
    vi.mocked(exists).mockResolvedValue(false);

    const result = await agentBackendValidator.validate(makeConfig({ agentDir: '/nonexistent/agents' }));

    expect(result.passed).toBe(false);
    expect(result.errors.some((e) => e.includes('/nonexistent/agents'))).toBe(true);
  });

  it('returns passed:true when CLI is found and agentDir exists', async () => {
    vi.mocked(exec).mockResolvedValue({ ...ok });
    vi.mocked(exists).mockResolvedValue(true);

    const result = await agentBackendValidator.validate(makeConfig());

    expect(result.passed).toBe(true);
    expect(result.errors).toHaveLength(0);
    expect(result.warnings).toHaveLength(0);
  });
});
