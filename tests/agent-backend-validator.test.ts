import { describe, it, expect, vi, beforeEach } from 'vitest';
import { makeRuntimeConfig } from './helpers/make-runtime-config.js';

vi.mock('../src/util/process.js', () => ({
  exec: vi.fn(),
}));

vi.mock('../src/util/fs.js', () => ({
  exists: vi.fn(),
}));

import { exec } from '../src/util/process.js';
import { exists } from '../src/util/fs.js';
import { agentBackendValidator } from '../src/validation/agent-backend-validator.js';

const makeConfig = (overrides: Partial<{ cliCommand: string; agentDir: string }> = {}) =>
  makeRuntimeConfig({
    copilot: {
      cliCommand: overrides.cliCommand ?? 'copilot',
      model: 'claude-sonnet-4.6',
      agentDir: overrides.agentDir ?? '/tmp/agents',
      timeout: 300_000,
    },
    agent: {
      backend: 'copilot' as const,
      copilot: { cliCommand: overrides.cliCommand ?? 'copilot', agentDir: overrides.agentDir ?? '/tmp/agents' },
      claude: { cliCommand: 'claude', agentDir: '/tmp/.cadre/test-project/agents' },
    },
  });

const makeConfigWithAgent = (
  backend: 'copilot' | 'claude',
  overrides: Partial<{ copilotCli: string; claudeCli: string; agentDir: string }> = {},
) =>
  makeRuntimeConfig({
    copilot: {
      cliCommand: 'copilot',
      model: 'claude-sonnet-4.6',
      agentDir: overrides.agentDir ?? '/tmp/agents',
      timeout: 300_000,
    },
    agent: {
      backend,
      copilot: { cliCommand: overrides.copilotCli ?? 'copilot', agentDir: '/tmp/agents' },
      claude: { cliCommand: overrides.claudeCli ?? 'claude', agentDir: overrides.agentDir ?? '/tmp/agents' },
    },
  });

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

  describe('with config.agent.backend = "copilot"', () => {
    it('should use agent.copilot.cliCommand when backend is copilot', async () => {
      vi.mocked(exec).mockResolvedValue({ exitCode: 0, stdout: '/usr/bin/copilot', stderr: '', signal: null, timedOut: false });
      vi.mocked(exists).mockResolvedValue(true);

      await agentBackendValidator.validate(makeConfigWithAgent('copilot', { copilotCli: 'gh-copilot' }));

      expect(exec).toHaveBeenCalledWith('which', ['gh-copilot']);
    });

    it('should include "agent.copilot.cliCommand" in error when copilot CLI is missing', async () => {
      vi.mocked(exec).mockResolvedValue({ exitCode: 1, stdout: '', stderr: 'not found', signal: null, timedOut: false });
      vi.mocked(exists).mockResolvedValue(true);

      const result = await agentBackendValidator.validate(makeConfigWithAgent('copilot', { copilotCli: 'missing-copilot' }));

      expect(result.passed).toBe(false);
      expect(result.errors[0]).toContain('agent.copilot.cliCommand');
    });

    it('should pass when copilot CLI is found and agentDir exists', async () => {
      vi.mocked(exec).mockResolvedValue({ exitCode: 0, stdout: '/usr/bin/copilot', stderr: '', signal: null, timedOut: false });
      vi.mocked(exists).mockResolvedValue(true);

      const result = await agentBackendValidator.validate(makeConfigWithAgent('copilot'));

      expect(result.passed).toBe(true);
      expect(result.errors).toHaveLength(0);
    });
  });

  describe('with config.agent.backend = "claude"', () => {
    it('should use agent.claude.cliCommand when backend is claude', async () => {
      vi.mocked(exec).mockResolvedValue({ exitCode: 0, stdout: '/usr/bin/claude', stderr: '', signal: null, timedOut: false });
      vi.mocked(exists).mockResolvedValue(true);

      await agentBackendValidator.validate(makeConfigWithAgent('claude', { claudeCli: 'claude' }));

      expect(exec).toHaveBeenCalledWith('which', ['claude']);
    });

    it('should return passed:false with "agent.claude.cliCommand" in error when claude CLI is missing', async () => {
      vi.mocked(exec).mockResolvedValue({ exitCode: 1, stdout: '', stderr: 'not found', signal: null, timedOut: false });
      vi.mocked(exists).mockResolvedValue(true);

      const result = await agentBackendValidator.validate(makeConfigWithAgent('claude', { claudeCli: 'missing-claude' }));

      expect(result.passed).toBe(false);
      expect(result.errors).toHaveLength(1);
      expect(result.errors[0]).toContain('missing-claude');
      expect(result.errors[0]).toContain('agent.claude.cliCommand');
    });

    it('should pass when claude CLI is found and agentDir exists', async () => {
      vi.mocked(exec).mockResolvedValue({ exitCode: 0, stdout: '/usr/bin/claude', stderr: '', signal: null, timedOut: false });
      vi.mocked(exists).mockResolvedValue(true);

      const result = await agentBackendValidator.validate(makeConfigWithAgent('claude'));

      expect(result.passed).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should check agent.claude.agentDir when backend is claude', async () => {
      vi.mocked(exec).mockResolvedValue({ exitCode: 0, stdout: '/usr/bin/claude', stderr: '', signal: null, timedOut: false });
      vi.mocked(exists).mockResolvedValue(true);

      await agentBackendValidator.validate(makeConfigWithAgent('claude', { agentDir: '/custom/agents' }));

      expect(exists).toHaveBeenCalledWith('/custom/agents');
    });

    it('should return two errors when claude CLI is missing and agentDir is absent', async () => {
      vi.mocked(exec).mockResolvedValue({ exitCode: 1, stdout: '', stderr: '', signal: null, timedOut: false });
      vi.mocked(exists).mockResolvedValue(false);

      const result = await agentBackendValidator.validate(makeConfigWithAgent('claude', { claudeCli: 'bad-claude', agentDir: '/bad/dir' }));

      expect(result.passed).toBe(false);
      expect(result.errors).toHaveLength(2);
      expect(result.errors.some((e) => e.includes('bad-claude'))).toBe(true);
      expect(result.errors.some((e) => e.includes('/bad/dir'))).toBe(true);
    });
  });
});
