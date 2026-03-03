import { describe, it, expect, vi, beforeEach } from 'vitest';
import { makeRuntimeConfig } from './helpers/make-runtime-config.js';

vi.mock('../src/util/process.js', () => ({
  exec: vi.fn(),
}));

vi.mock('../src/util/fs.js', () => ({
  exists: vi.fn(),
}));

vi.mock('../src/agents/backend-factory.js', () => ({
  hasAgentBackendFactory: vi.fn(() => true),
  listAgentBackendFactories: vi.fn(() => ['claude', 'copilot']),
}));

import { exec } from '../src/util/process.js';
import { exists } from '../src/util/fs.js';
import { hasAgentBackendFactory, listAgentBackendFactories } from '../src/agents/backend-factory.js';
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
    vi.mocked(hasAgentBackendFactory).mockReturnValue(true);
    vi.mocked(listAgentBackendFactories).mockReturnValue(['claude', 'copilot']);
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

  it('should fail when backend is not registered', async () => {
    vi.mocked(hasAgentBackendFactory).mockReturnValue(false);
    vi.mocked(listAgentBackendFactories).mockReturnValue(['copilot']);

    const result = await agentBackendValidator.validate(makeConfig());

    expect(result.passed).toBe(false);
    expect(result.errors[0]).toContain('not registered');
  });

  it('should return a warning when CLI command is not on PATH', async () => {
    vi.mocked(exec).mockResolvedValue({ exitCode: 1, stdout: '', stderr: 'not found', signal: null, timedOut: false });
    vi.mocked(exists).mockResolvedValue(true);

    const result = await agentBackendValidator.validate(makeConfig({ cliCommand: 'missing-cli' }));

    expect(result.passed).toBe(true);
    expect(result.errors).toHaveLength(0);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('missing-cli');
    expect(result.warnings[0]).toContain('PATH');
  });

  it('should return a warning when agentDir does not exist', async () => {
    vi.mocked(exec).mockResolvedValue({ exitCode: 0, stdout: '/usr/local/bin/copilot', stderr: '', signal: null, timedOut: false });
    vi.mocked(exists).mockResolvedValue(false);

    const result = await agentBackendValidator.validate(makeConfig({ agentDir: '/nonexistent/agents' }));

    expect(result.passed).toBe(true);
    expect(result.errors).toHaveLength(0);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain('/nonexistent/agents');
  });

  it('should return passed:true with two warnings when both CLI missing and agentDir absent', async () => {
    vi.mocked(exec).mockResolvedValue({ exitCode: 1, stdout: '', stderr: '', signal: null, timedOut: false });
    vi.mocked(exists).mockResolvedValue(false);

    const result = await agentBackendValidator.validate(makeConfig({ cliCommand: 'bad-cli', agentDir: '/bad/dir' }));

    expect(result.passed).toBe(true);
    expect(result.errors).toHaveLength(0);
    expect(result.warnings).toHaveLength(2);
    expect(result.warnings.some((e) => e.includes('bad-cli'))).toBe(true);
    expect(result.warnings.some((e) => e.includes('/bad/dir'))).toBe(true);
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

  it('should return an empty warnings array for healthy setup', async () => {
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

    it('should include backend name in warning when copilot CLI is missing', async () => {
      vi.mocked(exec).mockResolvedValue({ exitCode: 1, stdout: '', stderr: 'not found', signal: null, timedOut: false });
      vi.mocked(exists).mockResolvedValue(true);

      const result = await agentBackendValidator.validate(makeConfigWithAgent('copilot', { copilotCli: 'missing-copilot' }));

      expect(result.passed).toBe(true);
      expect(result.warnings[0]).toContain("backend 'copilot'");
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

    it('should return warning when claude CLI is missing', async () => {
      vi.mocked(exec).mockResolvedValue({ exitCode: 1, stdout: '', stderr: 'not found', signal: null, timedOut: false });
      vi.mocked(exists).mockResolvedValue(true);

      const result = await agentBackendValidator.validate(makeConfigWithAgent('claude', { claudeCli: 'missing-claude' }));

      expect(result.passed).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0]).toContain('missing-claude');
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

    it('should return two warnings when claude CLI is missing and agentDir is absent', async () => {
      vi.mocked(exec).mockResolvedValue({ exitCode: 1, stdout: '', stderr: '', signal: null, timedOut: false });
      vi.mocked(exists).mockResolvedValue(false);

      const result = await agentBackendValidator.validate(makeConfigWithAgent('claude', { claudeCli: 'bad-claude', agentDir: '/bad/dir' }));

      expect(result.passed).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(result.warnings).toHaveLength(2);
      expect(result.warnings.some((e) => e.includes('bad-claude'))).toBe(true);
      expect(result.warnings.some((e) => e.includes('/bad/dir'))).toBe(true);
    });
  });
});
