import type { RuntimeConfig } from '../config/loader.js';
import type { PlatformProvider } from './provider.js';
import { GitHubProvider } from './github-provider.js';
import { AzureDevOpsProvider } from './azure-devops-provider.js';
import type { Logger } from '../logging/logger.js';
import { Octokit } from '@octokit/rest';

/**
 * Resolve `${ENV_VAR}` references in strings.
 */
function resolveEnvRef(value: string): string {
  return value.replace(/\$\{(\w+)\}/g, (_, name) => process.env[name] ?? '');
}

/**
 * Resolve GitHub authentication from config and ensure GITHUB_TOKEN is set in process.env.
 *
 * Priority:
 * 1. Explicit token in config (`github.auth.token`)
 * 2. Explicit GitHub App in config (`github.auth.appId` + friends)
 * 3. Auto-detect from `GITHUB_TOKEN` or `GH_TOKEN` env var
 *
 * This makes CADRE work with:
 * - `gh auth token` piped into GITHUB_TOKEN
 * - Copilot CLI (which sets GITHUB_TOKEN)
 * - Claude CLI (env vars passed via environment)
 * - GitHub App for CI / org-level access
 */
function resolveGitHubAuthEnv(
  auth:
    | { token: string }
    | { appId: string; installationId: string; privateKeyFile: string }
    | undefined,
  logger: Logger,
): void {
  if (auth && 'token' in auth) {
    // Token-based auth (simplest)
    const token = resolveEnvRef(auth.token);
    if (token) {
      logger.info('Using token-based GitHub authentication');
      process.env.GITHUB_TOKEN = token;
      return;
    }
  }

  if (auth && 'appId' in auth) {
    // GitHub App auth
    logger.info('Using GitHub App authentication');
    // App credentials remain in config; token obtained at runtime
    return;
  }

  // Auto-detect from environment
  const envToken = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN ?? '';
  if (envToken) {
    logger.info('Auto-detected GITHUB_TOKEN from environment');
    if (!process.env.GITHUB_TOKEN) {
      process.env.GITHUB_TOKEN = envToken;
    }
    return;
  }

  logger.warn(
    'No GitHub authentication configured. Set GITHUB_TOKEN, add github.auth.token to config, or configure GitHub App auth.',
  );
}

/**
 * Create a PlatformProvider based on the config's `platform` field.
 *
 * Defaults to GitHub when `platform` is omitted for backward compatibility.
 */
export function createPlatformProvider(
  config: RuntimeConfig,
  logger: Logger,
): PlatformProvider {
  const platform = config.platform ?? 'github';

  switch (platform) {
    case 'github': {
      resolveGitHubAuthEnv(config.github?.auth, logger);
      return new GitHubProvider(
        config.repository,
        logger,
      );
    }

    case 'azure-devops': {
      const adoConfig = config.azureDevOps;
      if (!adoConfig) {
        throw new Error(
          'Azure DevOps platform selected but no "azureDevOps" configuration provided.',
        );
      }

      return new AzureDevOpsProvider(
        {
          organization: adoConfig.organization,
          project: adoConfig.project,
          repositoryName: adoConfig.repositoryName,
          auth: {
            pat: resolveEnvRef(adoConfig.auth.pat),
          },
        },
        logger,
      );
    }

    default:
      throw new Error(
        `Unknown platform "${platform}". Supported: "github", "azure-devops".`,
      );
  }
}
