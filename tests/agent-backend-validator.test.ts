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
  }) as unknown as CadreConfig;

describe('agentBackendValidator', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('should expose the name "agent-backend-validator"', () => {
    expect(agentBackendValidator.name).toBe('agent-backend-validator');
  });

  it('should return passed:true when CLI is found and agentDir exists', async () => {
    vi.mocked(exec).mockResolvedValue({ exitCode: 0, stdout: '/usr/local/bin/copilot', stderr: '', signal: null, timedOut: false });
    vi.mocked(exists).mockResolvedValue(true);

    const result = await agentBackendValidator.validate(makeConfig());

    expect(result.passed).toBe(true);
    expect(result.errors).toHaveLength(0);
    expect(result.warnings).toHaveLength(0);
  });

  it('should return passed:false when CLI command is not on PATH', async () => {
    vi.mocked(exec).mockResolvedValue({ exitCode: 1, stdout: '', stderr: 'not found', signal: null, timedOut: false });
    vi.mocked(exists).mockResolvedValue(true);

    const result = await agentBackendValidator.validate(makeConfig({ cliCommand: 'missing-cli' }));

    expect(result.passed).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain('missing-cli');
    expect(result.errors[0]).toContain('PATH');
  });

  it('should return passed:false when agentDir does not exist', async () => {
    vi.mocked(exec).mockResolvedValue({ exitCode: 0, stdout: '/usr/local/bin/copilot', stderr: '', signal: null, timedOut: false });
    vi.mocked(exists).mockResolvedValue(false);

    const result = await agentBackendValidator.validate(makeConfig({ agentDir: '/nonexistent/agents' }));

    expect(result.passed).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain('/nonexistent/agents');
  });

  it('should return passed:false with two errors when both CLI missing and agentDir absent', async () => {
    vi.mocked(exec).mockResolvedValue({ exitCode: 1, stdout: '', stderr: '', signal: null, timedOut: false });
    vi.mocked(exists).mockResolvedValue(false);

    const result = await agentBackendValidator.validate(makeConfig({ cliCommand: 'bad-cli', agentDir: '/bad/dir' }));

    expect(result.passed).toBe(false);
    expect(result.errors).toHaveLength(2);
    expect(result.errors.some((e) => e.includes('bad-cli'))).toBe(true);
    expect(result.errors.some((e) => e.includes('/bad/dir'))).toBe(true);
  });

  it('should call which with the configured cliCommand', async () => {
    vi.mocked(exec).mockResolvedValue({ exitCode: 0, stdout: '', stderr: '', signal: null, timedOut: false });
    vi.mocked(exists).mockResolvedValue(true);

    await agentBackendValidator.validate(makeConfig({ cliCommand: 'claude' }));

    expect(exec).toHaveBeenCalledWith('which', ['claude']);
  });

  it('should check existence of the configured agentDir', async () => {
    vi.mocked(exec).mockResolvedValue({ exitCode: 0, stdout: '', stderr: '', signal: null, timedOut: false });
    vi.mocked(exists).mockResolvedValue(true);

    await agentBackendValidator.validate(makeConfig({ agentDir: '/custom/agent/dir' }));

    expect(exists).toHaveBeenCalledWith('/custom/agent/dir');
  });

  it('should always return an empty warnings array', async () => {
    vi.mocked(exec).mockResolvedValue({ exitCode: 0, stdout: '', stderr: '', signal: null, timedOut: false });
    vi.mocked(exists).mockResolvedValue(true);

    const result = await agentBackendValidator.validate(makeConfig());

    expect(Array.isArray(result.warnings)).toBe(true);
    expect(result.warnings).toHaveLength(0);
  });
});
