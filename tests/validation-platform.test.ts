import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { makeRuntimeConfig } from './helpers/make-runtime-config.js';

vi.mock('../src/util/process.js', () => ({
  exec: vi.fn(),
}));

import { exec } from '../src/util/process.js';
import { platformValidator } from '../src/validation/platform-validator.js';

const ok = { exitCode: 0, stdout: '/usr/local/bin/github-mcp-server', stderr: '', signal: null, timedOut: false } as const;
const fail = { exitCode: 1, stdout: '', stderr: 'not found', signal: null, timedOut: false } as const;

const makeGithubConfig = (token?: string) =>
  makeRuntimeConfig({
    platform: 'github',
    ...(token !== undefined ? { github: { auth: { token } } } : {}),
  });

const makeAzureConfig = (pat: string) =>
  makeRuntimeConfig({
    platform: 'azure-devops',
    azureDevOps: { organization: 'myorg', project: 'myproject', auth: { pat } },
  });

describe('validation-platform', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    delete process.env['GITHUB_TOKEN'];
  });

  afterEach(() => {
    delete process.env['GITHUB_TOKEN'];
  });

  describe('github platform', () => {
    it('returns passed:false when github-mcp-server is not on PATH', async () => {
      vi.mocked(exec).mockResolvedValue({ ...fail });
      process.env['GITHUB_TOKEN'] = 'ghp_test';

      const result = await platformValidator.validate(makeGithubConfig());

      expect(result.passed).toBe(false);
      expect(result.errors.some((e) => e.includes('github-mcp-server'))).toBe(true);
    });

    it('returns passed:false when no GitHub token is configured or in env', async () => {
      vi.mocked(exec).mockResolvedValue({ ...ok });

      const result = await platformValidator.validate(makeGithubConfig(undefined));

      expect(result.passed).toBe(false);
      expect(result.errors.some((e) => e.includes('token') || e.includes('GITHUB_TOKEN'))).toBe(true);
    });

    it('returns passed:true when server is on PATH and token is set in config', async () => {
      vi.mocked(exec).mockResolvedValue({ ...ok });

      const result = await platformValidator.validate(makeGithubConfig('ghp_direct'));

      expect(result.passed).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('returns passed:true when server is on PATH and GITHUB_TOKEN env var is set', async () => {
      vi.mocked(exec).mockResolvedValue({ ...ok });
      process.env['GITHUB_TOKEN'] = 'ghp_env';

      const result = await platformValidator.validate(makeGithubConfig(undefined));

      expect(result.passed).toBe(true);
      expect(result.errors).toHaveLength(0);
    });
  });

  describe('azure-devops platform', () => {
    it('returns passed:true when PAT is a non-empty value', async () => {
      const result = await platformValidator.validate(makeAzureConfig('my-pat'));

      expect(result.passed).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('returns passed:false when PAT is empty', async () => {
      const result = await platformValidator.validate(makeAzureConfig(''));

      expect(result.passed).toBe(false);
      expect(result.errors.some((e) => e.includes('PAT') || e.includes('pat'))).toBe(true);
    });

    it('returns passed:true when PAT uses ${ENV_VAR} that resolves to a value', async () => {
      process.env['ADO_PAT'] = 'resolved-pat';

      const result = await platformValidator.validate(makeAzureConfig('${ADO_PAT}'));

      expect(result.passed).toBe(true);

      delete process.env['ADO_PAT'];
    });
  });
});
