# Test Result: task-004 - Create `createAgentBackend` factory

## Tests Written
- `tests/agent-backend-factory.test.ts`: 8 new test cases
  - returns a CopilotBackend when config.agent.backend is "copilot"
  - returns a ClaudeBackend when config.agent.backend is "claude"
  - returns a CopilotBackend when config.agent is absent (defaults to "copilot")
  - throws a descriptive error for an unknown backend value
  - thrown error for unknown backend mentions valid options
  - returned CopilotBackend has name "copilot"
  - returned ClaudeBackend has name "claude"
  - returned backend exposes init() and invoke() methods

## Test Files Modified
- (none)

## Test Files Created
- tests/agent-backend-factory.test.ts

## Coverage Notes
- The factory delegates all invocation logic to `CopilotBackend` / `ClaudeBackend`; their detailed behavior is already covered in `tests/agent-backend.test.ts`.
- The unknown-backend error path uses `as unknown as CadreConfig` to bypass TypeScript's enum narrowing, which is intentional for testing the runtime guard.
