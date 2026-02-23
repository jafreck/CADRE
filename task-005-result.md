# Task Result: task-005 - Refactor `AgentLauncher` to delegate to `AgentBackend`

## Changes Made
- `src/core/agent-launcher.ts`: Replaced inline spawn logic with backend delegation. Constructor now calls `createAgentBackend(config, logger)`. `init()` delegates to `this.backend.init()`. `launchAgent()` delegates to `this.backend.invoke()`. Removed `buildEnv`, `parseTokenUsage`, and all direct `config.copilot` access for spawn settings.

## Files Modified
- src/core/agent-launcher.ts

## Files Created
- (none)

## Notes
- `validateAgentFiles` static method is unchanged.
- Build passes with zero TypeScript errors.
- All 8 existing tests in `tests/agent-launcher.test.ts` pass without modification.
