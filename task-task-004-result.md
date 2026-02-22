# Task Result: task-004 - Implement PlatformValidator

## Changes Made
- `src/validation/platform-validator.ts`: Created new `platformValidator` object implementing `PreRunValidator`. For `github` platform, checks that the MCP server command exists on PATH via `which` and that either `github.auth` is configured or `GITHUB_TOKEN` env var is set. For `azure-devops` platform, checks that `azureDevOps.auth.pat` is non-empty.

## Files Modified
- (none)

## Files Created
- src/validation/platform-validator.ts

## Notes
- Validator name is `'platform'` (set both on the object property and in the returned `ValidationResult`)
- GitHub token check falls back to `GITHUB_TOKEN` env var when no `github.auth` is configured in the config
- GitHub App auth (appId/installationId/privateKeyFile) is treated as a valid token configuration
- Build passes with `npm run build`; the one pre-existing failing test in `github-issues.test.ts` is unrelated to this task
