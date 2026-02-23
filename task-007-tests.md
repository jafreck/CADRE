# Test Result: task-007 - Write unit tests for `backend.ts`

## Tests Written
- `tests/agent-backends.test.ts`: 53 test cases

  **AgentBackend interface (2)**
  - CopilotBackend satisfies AgentBackend interface
  - ClaudeBackend satisfies AgentBackend interface

  **CopilotBackend (25)**
  - should have name "copilot"
  - should resolve init() without error
  - should invoke spawnProcess with the configured CLI command
  - should include --agent, -p, --allow-all-tools, --allow-all-paths, --no-ask-user, -s args
  - should include --model when config.agent.model is set
  - should not include --model when no model is configured
  - should include the contextPath in the prompt
  - should call trackProcess on the spawned process
  - should return success=true on exit code 0
  - should return success=false on non-zero exit code
  - should return success=false when timedOut=true even if exitCode=0
  - should return the agent name in the result
  - should return outputExists=true when outputPath exists
  - should return outputExists=false when outputPath does not exist
  - should set CADRE_ISSUE_NUMBER env var
  - should set CADRE_WORKTREE_PATH env var
  - should set CADRE_PHASE env var
  - should set CADRE_TASK_ID env var when taskId is provided
  - should not set CADRE_TASK_ID env var when taskId is absent
  - should prepend extraPath to PATH
  - should write a log file for the invocation
  - should return tokenUsage=0 when stdout has no token info
  - should parse token usage from text pattern in stdout
  - should fall back to legacy config.copilot settings when config.agent is absent
  - should use invocation.timeout when provided

  **ClaudeBackend (21)**
  - should have name "claude"
  - should resolve init() without error
  - should invoke spawnProcess with the configured claude CLI command
  - should include -p, --allowedTools, and --output-format json args
  - should include --model when config.agent.model is set
  - should not include --model when no model is configured
  - should include the contextPath in the prompt
  - should return success=true on exit code 0
  - should return success=false on non-zero exit code
  - should return success=false when timedOut=true
  - should parse token usage from Claude JSON output format
  - should parse token usage from text patterns when stdout is not JSON
  - should return tokenUsage=0 when no token info is available
  - should set CADRE_ISSUE_NUMBER env var
  - should set CADRE_WORKTREE_PATH env var
  - should set CADRE_PHASE env var
  - should set CADRE_TASK_ID env var when taskId is provided
  - should call trackProcess on the spawned process
  - should write a log file for the invocation
  - should use invocation.timeout when provided
  - should default to "claude" CLI when config.agent.claude.cliCommand is absent

  **parseTokenUsage (via invoke) (5)**
  - should parse total_tokens pattern from stdout
  - should parse "usage: N tokens" pattern from stderr
  - should parse comma-separated numbers in token count
  - should handle JSON with partial usage fields gracefully
  - should return 0 for invalid JSON that is not a plain text token pattern

## Test Files Modified
- (none)

## Test Files Created
- tests/agent-backends.test.ts

## Coverage Notes
- All 53 tests pass with `npx vitest run tests/agent-backends.test.ts`.
- `init()` for both backends is trivial (resolves immediately); no deeper init logic exists to test.
- Log file path internals are not asserted in detail since the exact path pattern is an implementation detail.
