# Test Result: task-006 - Update `agentBackendValidator` to check selected backend CLI

## Tests Written
- `tests/agent-backend-validator.test.ts`: 8 new test cases added
  - with config.agent.backend = "copilot": should use agent.copilot.cliCommand when backend is copilot
  - with config.agent.backend = "copilot": should include "agent.copilot.cliCommand" in error when copilot CLI is missing
  - with config.agent.backend = "copilot": should pass when copilot CLI is found and agentDir exists
  - with config.agent.backend = "claude": should use agent.claude.cliCommand when backend is claude
  - with config.agent.backend = "claude": should return passed:false with "agent.claude.cliCommand" in error when claude CLI is missing
  - with config.agent.backend = "claude": should pass when claude CLI is found and agentDir exists
  - with config.agent.backend = "claude": should check copilot.agentDir even when backend is claude
  - with config.agent.backend = "claude": should return two errors when claude CLI is missing and agentDir is absent

## Test Files Modified
- tests/agent-backend-validator.test.ts (added `makeConfigWithAgent` helper and 8 new test cases in two nested `describe` blocks)

## Test Files Created
- (none)

## Coverage Notes
- All 8 original tests continue to pass (fallback/no-agent-property scenarios).
- New tests cover the `config.agent.backend = "copilot"` path, the `config.agent.backend = "claude"` path, correct error message key paths, and the invariant that `agentDir` is always read from `config.copilot.agentDir`.
