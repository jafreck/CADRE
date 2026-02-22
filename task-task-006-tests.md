# Test Result: task-006 - Write Tests for agents CLI and Updated Types

## Tests Written
- `tests/agents-cli.test.ts`: 13 test cases
  - **AGENT_DEFINITIONS registry (3)**
    - should contain exactly 12 entries
    - should have all required fields for every entry
    - should have no duplicate agent names
  - **agents validate CLI (5)**
    - should exit 0 and report success when all files exist and are non-empty
    - should exit 1 and include "Missing:" when a file does not exist
    - should exit 1 and include "Empty:" when a file is empty
    - should report one issue per agent when all files are missing
    - should suggest running scaffold when validation fails
  - **agents scaffold CLI (5)**
    - should write files for all agents to the agentDir
    - should skip existing files without --force
    - should overwrite existing files with --force
    - should scaffold only the named agent with --agent
    - should exit 1 for an unknown --agent name

## Test Files Modified
- (none)

## Test Files Created
- tests/agents-cli.test.ts

## Coverage Notes
- Template file resolution is tested indirectly via `readFile` mock; the actual template content is not verified (template rendering is out of scope)
- `tests/agent-launcher.test.ts` was not modified — the public `validateAgentFiles` static method signature is unchanged from task-005
- All 13 tests pass with `npx vitest run tests/agents-cli.test.ts`
