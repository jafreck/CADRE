import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { createPlatformProvider } from '../src/platform/factory.js';
import { GitHubProvider } from '../src/platform/github-provider.js';
import { AzureDevOpsProvider } from '../src/platform/azure-devops-provider.js';
import { makeRuntimeConfig } from './helpers/make-runtime-config.js';

vi.mock('../src/platform/github-provider.js', () => ({
  GitHubProvider: vi.fn().mockImplementation(() => ({ name: 'GitHub' })),
}));

vi.mock('../src/platform/azure-devops-provider.js', () => ({
  AzureDevOpsProvider: vi.fn().mockImplementation(() => ({ name: 'Azure DevOps' })),
}));

function makeLogger() {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  } as never;
}

describe('createPlatformProvider', () => {
  let originalEnv: Record<string, string | undefined>;

  beforeEach(() => {
    vi.clearAllMocks();
    originalEnv = {
      GITHUB_TOKEN: process.env.GITHUB_TOKEN,
      GH_TOKEN: process.env.GH_TOKEN,
    };
    delete process.env.GITHUB_TOKEN;
    delete process.env.GH_TOKEN;
  });

  afterEach(() => {
    process.env.GITHUB_TOKEN = originalEnv.GITHUB_TOKEN;
    process.env.GH_TOKEN = originalEnv.GH_TOKEN;
    if (originalEnv.GITHUB_TOKEN === undefined) delete process.env.GITHUB_TOKEN;
    if (originalEnv.GH_TOKEN === undefined) delete process.env.GH_TOKEN;
  });

  describe('GitHub platform', () => {
    it('should return a GitHubProvider when platform is "github"', () => {
      const config = makeRuntimeConfig({ platform: 'github' });
      const provider = createPlatformProvider(config, makeLogger());
      expect(provider).toBeDefined();
      expect(vi.mocked(GitHubProvider)).toHaveBeenCalled();
    });

    it('should return a GitHubProvider when platform is omitted (default)', () => {
      const config = makeRuntimeConfig({ platform: undefined as never });
      const provider = createPlatformProvider(config, makeLogger());
      expect(provider).toBeDefined();
      expect(vi.mocked(GitHubProvider)).toHaveBeenCalled();
    });

    it('should set GITHUB_TOKEN when explicit token is provided in config', () => {
      const config = makeRuntimeConfig({
        platform: 'github',
        github: { auth: { token: 'explicit-token-123' } } as never,
      });
      createPlatformProvider(config, makeLogger());
      expect(process.env.GITHUB_TOKEN).toBe('explicit-token-123');
    });

    it('should resolve ${ENV_VAR} references in the token', () => {
      process.env.MY_SECRET_TOKEN = 'resolved-secret';
      const config = makeRuntimeConfig({
        platform: 'github',
        github: { auth: { token: '${MY_SECRET_TOKEN}' } } as never,
      });
      createPlatformProvider(config, makeLogger());
      expect(process.env.GITHUB_TOKEN).toBe('resolved-secret');
      delete process.env.MY_SECRET_TOKEN;
    });

    it('should auto-detect GITHUB_TOKEN from environment when no config auth is provided', () => {
      process.env.GITHUB_TOKEN = 'env-token-abc';
      const config = makeRuntimeConfig({ platform: 'github' });
      const logger = makeLogger();
      createPlatformProvider(config, logger);
      expect(process.env.GITHUB_TOKEN).toBe('env-token-abc');
    });

    it('should promote GH_TOKEN to GITHUB_TOKEN when GITHUB_TOKEN is absent', () => {
      process.env.GH_TOKEN = 'gh-token-xyz';
      const config = makeRuntimeConfig({ platform: 'github' });
      createPlatformProvider(config, makeLogger());
      expect(process.env.GITHUB_TOKEN).toBe('gh-token-xyz');
    });

    it('should warn when no GitHub authentication is configured', () => {
      const config = makeRuntimeConfig({ platform: 'github' });
      const logger = makeLogger();
      createPlatformProvider(config, logger);
      expect(logger.warn).toHaveBeenCalledWith(expect.stringContaining('No GitHub authentication'));
    });

    it('should log info when token-based auth is used', () => {
      const config = makeRuntimeConfig({
        platform: 'github',
        github: { auth: { token: 'my-token' } } as never,
      });
      const logger = makeLogger();
      createPlatformProvider(config, logger);
      expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('token-based'));
    });

    it('should log info when GitHub App auth is used', () => {
      const config = makeRuntimeConfig({
        platform: 'github',
        github: {
          auth: { appId: '123', installationId: '456', privateKeyFile: '/path/to/key.pem' },
        } as never,
      });
      const logger = makeLogger();
      createPlatformProvider(config, logger);
      expect(logger.info).toHaveBeenCalledWith(expect.stringContaining('GitHub App'));
    });

    it('should pass repository to GitHubProvider constructor', () => {
      const config = makeRuntimeConfig({ platform: 'github', repository: 'myorg/myrepo' });
      createPlatformProvider(config, makeLogger());
      expect(vi.mocked(GitHubProvider)).toHaveBeenCalledWith('myorg/myrepo', expect.anything());
    });
  });

  describe('Azure DevOps platform', () => {
    function makeAdoConfig(patOverride = 'my-pat') {
      return makeRuntimeConfig({
        platform: 'azure-devops',
        azureDevOps: {
          organization: 'myorg',
          project: 'myproject',
          repositoryName: 'myrepo',
          auth: { pat: patOverride },
        },
      } as never);
    }

    it('should return an AzureDevOpsProvider when platform is "azure-devops"', () => {
      const config = makeAdoConfig();
      const provider = createPlatformProvider(config, makeLogger());
      expect(provider).toBeDefined();
      expect(vi.mocked(AzureDevOpsProvider)).toHaveBeenCalled();
    });

    it('should throw when platform is "azure-devops" but no azureDevOps config provided', () => {
      const config = makeRuntimeConfig({ platform: 'azure-devops' as never });
      expect(() => createPlatformProvider(config, makeLogger())).toThrow(
        /Azure DevOps platform selected but no "azureDevOps" configuration/,
      );
    });

    it('should resolve ${ENV_VAR} references in the PAT', () => {
      process.env.ADO_PAT = 'resolved-pat-token';
      const config = makeAdoConfig('${ADO_PAT}');
      createPlatformProvider(config, makeLogger());
      const callArg = vi.mocked(AzureDevOpsProvider).mock.calls[0][0];
      expect(callArg.auth.pat).toBe('resolved-pat-token');
      delete process.env.ADO_PAT;
    });

    it('should pass organization, project, and repositoryName to AzureDevOpsProvider', () => {
      const config = makeAdoConfig();
      createPlatformProvider(config, makeLogger());
      expect(vi.mocked(AzureDevOpsProvider)).toHaveBeenCalledWith(
        expect.objectContaining({
          organization: 'myorg',
          project: 'myproject',
          repositoryName: 'myrepo',
        }),
        expect.anything(),
      );
    });
  });

  describe('Unknown platform', () => {
    it('should throw for an unknown platform value', () => {
      const config = makeRuntimeConfig({ platform: 'bitbucket' as never });
      expect(() => createPlatformProvider(config, makeLogger())).toThrow(
        /Unknown platform "bitbucket"/,
      );
    });

    it('should include supported platforms in the error message', () => {
      const config = makeRuntimeConfig({ platform: 'gitlab' as never });
      expect(() => createPlatformProvider(config, makeLogger())).toThrow(
        /Supported.*github.*azure-devops/,
      );
    });
  });
});
