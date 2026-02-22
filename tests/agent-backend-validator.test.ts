import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CadreConfigSchema } from '../src/config/schema.js';

vi.mock('../src/util/process.js', () => ({
  exec: vi.fn(),
}));

vi.mock('../src/util/fs.js', () => ({
  exists: vi.fn(),
}));

import { exec } from '../src/util/process.js';
import { exists } from '../src/util/fs.js';
import { agentBackendValidator } from '../src/validation/agent-backend-validator.js';

const baseConfig = CadreConfigSchema.parse({
  projectName: 'test-project',
  repository: 'owner/repo',
  repoPath: '/tmp/repo',
  issues: { ids: [1] },
});

describe('agentBackendValidator', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('should have name "agent-backend"', () => {
    expect(agentBackendValidator.name).toBe('agent-backend');
  });

  it('should pass when CLI command is found and agent dir exists', async () => {
    vi.mocked(exec).mockResolvedValue({ exitCode: 0, stdout: '/usr/bin/copilot', stderr: '', signal: null, timedOut: false });
    vi.mocked(exists).mockResolvedValue(true);

    const result = await agentBackendValidator.validate(baseConfig);

    expect(result.passed).toBe(true);
    expect(result.errors).toHaveLength(0);
    expect(result.warnings).toHaveLength(0);
  });

  it('should fail when CLI command is not found on PATH', async () => {
    vi.mocked(exec).mockResolvedValue({ exitCode: 1, stdout: '', stderr: 'not found', signal: null, timedOut: false });
    vi.mocked(exists).mockResolvedValue(true);

    const result = await agentBackendValidator.validate(baseConfig);

    expect(result.passed).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain('copilot');
    expect(result.errors[0]).toContain('not found on PATH');
  });

  it('should fail when agent directory does not exist', async () => {
    vi.mocked(exec).mockResolvedValue({ exitCode: 0, stdout: '/usr/bin/copilot', stderr: '', signal: null, timedOut: false });
    vi.mocked(exists).mockResolvedValue(false);

    const result = await agentBackendValidator.validate(baseConfig);

    expect(result.passed).toBe(false);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain('.github/agents');
    expect(result.errors[0]).toContain('does not exist');
  });

  it('should fail with two errors when both CLI command and agent dir checks fail', async () => {
    vi.mocked(exec).mockResolvedValue({ exitCode: 1, stdout: '', stderr: '', signal: null, timedOut: false });
    vi.mocked(exists).mockResolvedValue(false);

    const result = await agentBackendValidator.validate(baseConfig);

    expect(result.passed).toBe(false);
    expect(result.errors).toHaveLength(2);
  });

  it('should use the configured cliCommand when checking PATH', async () => {
    vi.mocked(exec).mockResolvedValue({ exitCode: 0, stdout: '/usr/local/bin/gh', stderr: '', signal: null, timedOut: false });
    vi.mocked(exists).mockResolvedValue(true);

    const customConfig = CadreConfigSchema.parse({
      projectName: 'test-project',
      repository: 'owner/repo',
      repoPath: '/tmp/repo',
      issues: { ids: [1] },
      copilot: { cliCommand: 'gh', agentDir: '.github/agents', timeout: 300000 },
    });

    await agentBackendValidator.validate(customConfig);

    expect(exec).toHaveBeenCalledWith('which', ['gh']);
  });

  it('should use the configured agentDir when checking existence', async () => {
    vi.mocked(exec).mockResolvedValue({ exitCode: 0, stdout: '/usr/bin/copilot', stderr: '', signal: null, timedOut: false });
    vi.mocked(exists).mockResolvedValue(true);

    const customConfig = CadreConfigSchema.parse({
      projectName: 'test-project',
      repository: 'owner/repo',
      repoPath: '/tmp/repo',
      issues: { ids: [1] },
      copilot: { cliCommand: 'copilot', agentDir: '/custom/agents', timeout: 300000 },
    });

    await agentBackendValidator.validate(customConfig);

    expect(exists).toHaveBeenCalledWith('/custom/agents');
  });

  it('should include the cliCommand name in the error message', async () => {
    vi.mocked(exec).mockResolvedValue({ exitCode: 1, stdout: '', stderr: '', signal: null, timedOut: false });
    vi.mocked(exists).mockResolvedValue(true);

    const customConfig = CadreConfigSchema.parse({
      projectName: 'test-project',
      repository: 'owner/repo',
      repoPath: '/tmp/repo',
      issues: { ids: [1] },
      copilot: { cliCommand: 'my-cli', agentDir: '.github/agents', timeout: 300000 },
    });

    const result = await agentBackendValidator.validate(customConfig);

    expect(result.errors[0]).toContain('my-cli');
  });

  it('should include the agentDir path in the error message', async () => {
    vi.mocked(exec).mockResolvedValue({ exitCode: 0, stdout: '/usr/bin/copilot', stderr: '', signal: null, timedOut: false });
    vi.mocked(exists).mockResolvedValue(false);

    const customConfig = CadreConfigSchema.parse({
      projectName: 'test-project',
      repository: 'owner/repo',
      repoPath: '/tmp/repo',
      issues: { ids: [1] },
      copilot: { cliCommand: 'copilot', agentDir: '/my/custom/agents', timeout: 300000 },
    });

    const result = await agentBackendValidator.validate(customConfig);

    expect(result.errors[0]).toContain('/my/custom/agents');
  });
});
