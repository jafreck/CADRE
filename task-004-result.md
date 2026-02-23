# Task Result: task-004 - Create `createAgentBackend` factory

## Changes Made
- `src/agents/backend-factory.ts`: Created new file exporting `createAgentBackend(config, logger)` factory function that returns `CopilotBackend` for `"copilot"`, `ClaudeBackend` for `"claude"`, and throws a descriptive error for unknown backend values.

## Files Modified
- (none)

## Files Created
- src/agents/backend-factory.ts

## Notes
- Reads `config.agent?.backend` with a fallback to `'copilot'` to match existing loader defaults.
- Build passes with zero TypeScript errors.
