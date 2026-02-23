# Task Result: task-006 - Update `agentBackendValidator` to check selected backend CLI

## Changes Made
- `src/validation/agent-backend-validator.ts`: Updated validator to select CLI command based on `config.agent.backend`. When `config.agent` is undefined, falls back to `config.copilot.cliCommand` (preserving backward compatibility). When `config.agent.backend === "copilot"`, uses `config.agent.copilot.cliCommand`. When `config.agent.backend === "claude"`, uses `config.agent.claude.cliCommand`. The `agentDir` check always uses `config.copilot.agentDir` for all backends.

## Files Modified
- src/validation/agent-backend-validator.ts

## Files Created
- (none)

## Notes
- All 8 existing tests in `tests/agent-backend-validator.test.ts` pass without modification, because those tests build configs without an `agent` property, triggering the fallback to `config.copilot.cliCommand`.
- Error messages now include the correct config key path (`copilot.cliCommand`, `agent.copilot.cliCommand`, or `agent.claude.cliCommand`) depending on which backend is active.
- A config with `agent.backend = "claude"` and a missing `claude` CLI will produce an error: `CLI command 'claude' not found on PATH. Install it or set agent.claude.cliCommand to the correct command name.`
