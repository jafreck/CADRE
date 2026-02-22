import { exec } from '../util/process.js';
import type { PreRunValidator, ValidationResult } from './types.js';
import type { CadreConfig } from '../config/schema.js';

/** Expand ${ENV_VAR} placeholders using process.env. Returns empty string if any variable is unset/empty. */
function expandEnvVar(value: string): string {
  return value.replace(/\$\{([^}]+)\}/g, (_, name) => process.env[name] ?? '');
}

export const platformValidator: PreRunValidator = {
  name: 'platform',

  async validate(config: CadreConfig): Promise<ValidationResult> {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (config.platform === 'github') {
      // Check github-mcp-server is on PATH
      const whichResult = await exec('which', ['github-mcp-server']);
      if (whichResult.exitCode !== 0) {
        errors.push(
          "Command 'github-mcp-server' not found on PATH. Install it or configure config.github.mcpServer.command.",
        );
      }

      // Check a GitHub token is available
      const authToken =
        config.github?.auth && 'token' in config.github.auth
          ? expandEnvVar(config.github.auth.token)
          : '';
      const envToken = process.env['GITHUB_TOKEN'] ?? '';

      if (!authToken && !envToken) {
        errors.push(
          'No GitHub token found. Set GITHUB_TOKEN environment variable or configure config.github.auth.',
        );
      }
    } else if (config.platform === 'azure-devops') {
      // Check PAT resolves to a non-empty value
      const pat = config.azureDevOps?.auth?.pat ?? '';
      const resolvedPat = expandEnvVar(pat);
      if (!resolvedPat) {
        errors.push(
          'Azure DevOps PAT is empty or unresolved. Set config.azureDevOps.auth.pat to a non-empty value (${ENV_VAR} syntax is supported).',
        );
      }
    }

    return {
      passed: errors.length === 0,
      errors,
      warnings,
    };
  },
};
