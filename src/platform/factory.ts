import type { RuntimeConfig } from '../config/loader.js';
import type { PlatformProvider } from './provider.js';
import { GitHubProvider } from './github-provider.js';
import { AzureDevOpsProvider } from './azure-devops-provider.js';
import type { Logger } from '../logging/logger.js';

/**
 * Resolve `${ENV_VAR}` references in strings.
 */
function resolveEnvRef(value: string): string {
  return value.replace(/\$\{(\w+)\}/g, (_, name) => process.env[name] ?? '');
}

/**
 * Build the MCP server env vars for GitHub authentication.
 *
 * Priority:
 * 1. Explicit token in config (`github.auth.token`)
 * 2. Explicit GitHub App in config (`github.auth.appId` + friends)
 * 3. Auto-detect from `GITHUB_TOKEN` env var
 *
 * This makes CADRE work with:
 * - `gh auth token` piped into GITHUB_TOKEN
 * - Copilot CLI (which sets GITHUB_TOKEN)
 * - Claude CLI (env vars passed to MCP server)
 * - GitHub App for CI / org-level access
 */
function resolveGitHubAuthEnv(
  auth:
    | { token: string }
    | { appId: string; installationId: string; privateKeyFile: string }
    | undefined,
  logger: Logger,
): Record<string, string> {
  if (auth && 'token' in auth) {
    // Token-based auth (simplest)
    const token = resolveEnvRef(auth.token);
    if (token) {
      logger.info('Using token-based GitHub authentication');
      return { GITHUB_PERSONAL_ACCESS_TOKEN: token };
    }
  }

  if (auth && 'appId' in auth) {
    // GitHub App auth
    logger.info('Using GitHub App authentication');
    return {
      GITHUB_APP_ID: resolveEnvRef(auth.appId),
      GITHUB_APP_INSTALLATION_ID: resolveEnvRef(auth.installationId),
      GITHUB_APP_PRIVATE_KEY_FILE: resolveEnvRef(auth.privateKeyFile),
    };
  }

  // Auto-detect from environment
  const envToken = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN ?? '';
  if (envToken) {
    logger.info('Auto-detected GITHUB_TOKEN from environment');
    return { GITHUB_PERSONAL_ACCESS_TOKEN: envToken };
  }

  logger.warn(
    'No GitHub authentication configured. Set GITHUB_TOKEN, add github.auth.token to config, or configure GitHub App auth.',
  );
  return {};
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
