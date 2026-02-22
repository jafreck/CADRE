import type { CadreConfig } from '../config/schema.js';
import { exec } from '../util/process.js';
import type { PreRunValidator, ValidationResult } from './types.js';

export const platformValidator: PreRunValidator = {
  name: 'platform',

  async validate(config: CadreConfig): Promise<ValidationResult> {
    const errors: string[] = [];
    const warnings: string[] = [];

    if (config.platform === 'github') {
      // Check that the GitHub MCP server command exists on PATH
      const mcpCommand = config.github?.mcpServer?.command ?? 'github-mcp-server';
      const whichResult = await exec('which', [mcpCommand]);
      if (whichResult.exitCode !== 0) {
        errors.push(`GitHub MCP server command '${mcpCommand}' not found on PATH`);
      }

      // Check that a GitHub token is configured
      const hasConfiguredToken =
        config.github?.auth !== undefined &&
        ('token' in config.github.auth
          ? config.github.auth.token.trim().length > 0
          : config.github.auth.appId.trim().length > 0);
      const hasEnvToken = (process.env['GITHUB_TOKEN'] ?? '').trim().length > 0;

      if (!hasConfiguredToken && !hasEnvToken) {
        errors.push(
          'No GitHub token configured. Set GITHUB_TOKEN env var or configure github.auth in cadre.config.json',
        );
      }
    } else if (config.platform === 'azure-devops') {
      // Check that the Azure DevOps PAT is non-empty
      const pat = config.azureDevOps?.auth?.pat ?? '';
      if (pat.trim().length === 0) {
        errors.push('Azure DevOps PAT is missing or empty. Configure azureDevOps.auth.pat in cadre.config.json');
      }
    }

    return {
      passed: errors.length === 0,
      errors,
      warnings,
      name: 'platform',
    };
  },
};
