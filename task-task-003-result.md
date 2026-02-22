# Task Result: task-003 - Implement AgentBackendValidator

## Changes Made
- `src/validation/agent-backend-validator.ts`: Created `agentBackendValidator` implementing `PreRunValidator`. Checks that `config.copilot.cliCommand` is on PATH via `which` and that `config.copilot.agentDir` exists on disk.

## Files Modified
- (none)

## Files Created
- src/validation/agent-backend-validator.ts

## Notes
- Uses `exec('which', [cliCommand])` to check CLI availability; non-zero exit means not found.
- Uses `exists(agentDir)` from `src/util/fs.ts` to check agent directory presence.
- Returns `passed: true` only when both checks succeed.
