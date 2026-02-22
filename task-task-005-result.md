# Task Result: task-005 - Add Optional Pre-flight Agent Validation to cadre run

## Changes Made
- `src/core/agent-launcher.ts`: Added static `validateAgentFiles(agentDir: string): Promise<string[]>` method that checks all `AGENT_DEFINITIONS` agent files exist and are non-empty using `statOrNull`; also added imports for `resolve`, `AGENT_DEFINITIONS`, and `statOrNull`
- `src/index.ts`: Added `--skip-agent-validation` flag to the `run` command; imported `AgentLauncher`; added pre-flight validation block that calls `AgentLauncher.validateAgentFiles()` before `runtime.run()`, exiting with code 1 and a descriptive error if validation fails and the flag is not set

## Files Modified
- src/core/agent-launcher.ts
- src/index.ts

## Files Created
- (none)

## Notes
- `validateAgentFiles` is implemented as a static method on `AgentLauncher` so it can be called without a full instance (no config/logger needed)
- Validation logic mirrors the existing `cadre agents validate` command (same `statOrNull` checks for missing/empty files)
- The `--skip-agent-validation` flag is parsed by commander as `opts.skipAgentValidation` (camelCase)
- TypeScript compilation succeeds with no errors; the one pre-existing test failure in `tests/github-issues.test.ts` is unrelated to these changes
