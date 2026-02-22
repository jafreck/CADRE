import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { CadreConfig } from '../src/config/schema.js';

vi.mock('../src/util/process.js', () => ({
  exec: vi.fn(),
}));

import { exec } from '../src/util/process.js';
import { platformValidator } from '../src/validation/platform-validator.js';

const okResult = { exitCode: 0, stdout: '/usr/local/bin/github-mcp-server', stderr: '', signal: null, timedOut: false } as const;
const failResult = { exitCode: 1, stdout: '', stderr: 'not found', signal: null, timedOut: false } as const;

const makeGithubConfig = (
  overrides: Partial<{ token: string | undefined; envToken: string | undefined }> = {},
): CadreConfig =>
  ({
    projectName: 'test-project',
    platform: 'github',
    repository: 'owner/repo',
    repoPath: '/tmp/repo',
    baseBranch: 'main',
    issues: { ids: [1] },
    copilot: { cliCommand: 'copilot', agentDir: '.github/agents', timeout: 300000 },
    github:
      overrides.token !== undefined
        ? { auth: { token: overrides.token } }
        : undefined,
  }) as unknown as CadreConfig;

const makeAzureConfig = (pat: string): CadreConfig =>
  ({
    projectName: 'test-project',
    platform: 'azure-devops',
    repository: 'my-repo',
    repoPath: '/tmp/repo',
    baseBranch: 'main',
    issues: { ids: [1] },
    copilot: { cliCommand: 'copilot', agentDir: '.github/agents', timeout: 300000 },
    azureDevOps: {
      organization: 'myorg',
      project: 'myproject',
      auth: { pat },
    },
  }) as unknown as CadreConfig;

describe('platformValidator', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    delete process.env['GITHUB_TOKEN'];
  });

  afterEach(() => {
    delete process.env['GITHUB_TOKEN'];
  });

  it('should expose the name "platform"', () => {
    expect(platformValidator.name).toBe('platform');
  });

  describe('when platform is "github"', () => {
    it('should return passed:true when github-mcp-server is on PATH and GITHUB_TOKEN is set', async () => {
      vi.mocked(exec).mockResolvedValue({ ...okResult });
      process.env['GITHUB_TOKEN'] = 'ghp_token123';

      const result = await platformValidator.validate(makeGithubConfig());

      expect(result.passed).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should return passed:false when github-mcp-server is not on PATH', async () => {
      vi.mocked(exec).mockResolvedValue({ ...failResult });
      process.env['GITHUB_TOKEN'] = 'ghp_token123';

      const result = await platformValidator.validate(makeGithubConfig());

      expect(result.passed).toBe(false);
      expect(result.errors.some((e) => e.includes('github-mcp-server'))).toBe(true);
      expect(result.errors.some((e) => e.includes('PATH'))).toBe(true);
    });

    it('should return passed:false when no GitHub token is available', async () => {
      vi.mocked(exec).mockResolvedValue({ ...okResult });

      const result = await platformValidator.validate(makeGithubConfig({ token: undefined }));

      expect(result.passed).toBe(false);
      expect(result.errors.some((e) => e.includes('GITHUB_TOKEN') || e.includes('token'))).toBe(true);
    });

    it('should return passed:true when token is set via config', async () => {
      vi.mocked(exec).mockResolvedValue({ ...okResult });

      const result = await platformValidator.validate(makeGithubConfig({ token: 'ghp_direct_token' }));

      expect(result.passed).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should return passed:true when token is set via GITHUB_TOKEN env var (no config token)', async () => {
      vi.mocked(exec).mockResolvedValue({ ...okResult });
      process.env['GITHUB_TOKEN'] = 'ghp_env_token';

      const result = await platformValidator.validate(makeGithubConfig({ token: undefined }));

      expect(result.passed).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should expand ${ENV_VAR} in config token', async () => {
      vi.mocked(exec).mockResolvedValue({ ...okResult });
      process.env['MY_TOKEN'] = 'ghp_expanded';

      const result = await platformValidator.validate(makeGithubConfig({ token: '${MY_TOKEN}' }));

      expect(result.passed).toBe(true);
      expect(result.errors).toHaveLength(0);

      delete process.env['MY_TOKEN'];
    });

    it('should return passed:false when config token expands to empty string and no GITHUB_TOKEN', async () => {
      vi.mocked(exec).mockResolvedValue({ ...okResult });

      const result = await platformValidator.validate(makeGithubConfig({ token: '${UNSET_VAR_XYZ}' }));

      expect(result.passed).toBe(false);
      expect(result.errors.some((e) => e.includes('token') || e.includes('GITHUB_TOKEN'))).toBe(true);
    });

    it('should return passed:false with two errors when both MCP server missing and no token', async () => {
      vi.mocked(exec).mockResolvedValue({ ...failResult });

      const result = await platformValidator.validate(makeGithubConfig({ token: undefined }));

      expect(result.passed).toBe(false);
      expect(result.errors).toHaveLength(2);
    });

    it('should call exec with which and github-mcp-server', async () => {
      vi.mocked(exec).mockResolvedValue({ ...okResult });
      process.env['GITHUB_TOKEN'] = 'ghp_token';

      await platformValidator.validate(makeGithubConfig());

      expect(exec).toHaveBeenCalledWith('which', ['github-mcp-server']);
    });

    it('should always return an empty warnings array', async () => {
      vi.mocked(exec).mockResolvedValue({ ...okResult });
      process.env['GITHUB_TOKEN'] = 'ghp_token';

      const result = await platformValidator.validate(makeGithubConfig());

      expect(Array.isArray(result.warnings)).toBe(true);
      expect(result.warnings).toHaveLength(0);
    });
  });

  describe('when platform is "azure-devops"', () => {
    it('should return passed:true when PAT is a non-empty direct value', async () => {
      const result = await platformValidator.validate(makeAzureConfig('my-pat-value'));

      expect(result.passed).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(exec).not.toHaveBeenCalled();
    });

    it('should return passed:false when PAT is an empty string', async () => {
      const result = await platformValidator.validate(makeAzureConfig(''));

      expect(result.passed).toBe(false);
      expect(result.errors.some((e) => e.includes('PAT') || e.includes('pat'))).toBe(true);
    });

    it('should return passed:true when PAT uses ${ENV_VAR} that resolves to a non-empty value', async () => {
      process.env['ADO_PAT'] = 'resolved-pat';

      const result = await platformValidator.validate(makeAzureConfig('${ADO_PAT}'));

      expect(result.passed).toBe(true);
      expect(result.errors).toHaveLength(0);

      delete process.env['ADO_PAT'];
    });

    it('should return passed:false when PAT uses ${ENV_VAR} that resolves to empty', async () => {
      const result = await platformValidator.validate(makeAzureConfig('${UNSET_ADO_PAT_XYZ}'));

      expect(result.passed).toBe(false);
      expect(result.errors).toHaveLength(1);
    });

    it('should not call exec for azure-devops validation', async () => {
      await platformValidator.validate(makeAzureConfig('some-pat'));

      expect(exec).not.toHaveBeenCalled();
    });
  });
});
