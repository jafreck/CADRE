import type { CadreConfig } from '../config/schema.js';
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
 * Create a PlatformProvider based on the config's `platform` field.
 *
 * Defaults to GitHub when `platform` is omitted for backward compatibility.
 */
export function createPlatformProvider(
  config: CadreConfig,
  logger: Logger,
): PlatformProvider {
  const platform = config.platform ?? 'github';

  switch (platform) {
    case 'github': {
      const ghConfig = config.github;
      if (!ghConfig) {
        throw new Error(
          'GitHub platform selected but no "github" configuration provided.',
        );
      }

      const appAuth = ghConfig.auth;
      const mcpEnv: Record<string, string> = {
        GITHUB_APP_ID: resolveEnvRef(appAuth.appId),
        GITHUB_APP_INSTALLATION_ID: resolveEnvRef(appAuth.installationId),
        GITHUB_APP_PRIVATE_KEY_FILE: resolveEnvRef(appAuth.privateKeyFile),
      };

      return new GitHubProvider(
        config.repository,
        {
          command: ghConfig.mcpServer.command,
          args: ghConfig.mcpServer.args,
          env: mcpEnv,
        },
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
