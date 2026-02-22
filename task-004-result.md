# Task Result: task-004 - Implement Platform Validator

## Changes Made
- `src/validation/platform-validator.ts`: Created new file implementing `platformValidator` that checks platform-specific prerequisites

## Files Modified
- (none)

## Files Created
- src/validation/platform-validator.ts

## Notes
- For GitHub platform: checks `github-mcp-server` is on PATH via `exec('which', ...)` and that a token is available from `config.github.auth.token` (with `${ENV_VAR}` expansion) or `GITHUB_TOKEN` env var
- For Azure DevOps platform: checks `config.azureDevOps.auth.pat` resolves to a non-empty string after `${ENV_VAR}` expansion
- Follows the same `PreRunValidator` interface pattern as `gitValidator` and `agentBackendValidator`
- Uses `exec` from `src/util/process.ts` as required
