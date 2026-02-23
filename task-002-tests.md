# Test Result: task-002 - Add backward-compat normalisation in config loader

## Tests Written
- `tests/config-loader-agent.test.ts`: 12 new test cases
  - should synthesize agent from copilot config when no agent key is present
  - should set agent.copilot.cliCommand from copilot.cliCommand when synthesizing
  - should set agent.model from copilot.model when synthesizing
  - should set agent.timeout from copilot.timeout when synthesizing
  - should preserve explicit agent.backend = "claude" unchanged
  - should preserve explicit agent config entirely when agent key is present
  - should preserve explicit copilot backend agent config unchanged
  - should set agent.copilot.agentDir from copilot.agentDir when synthesizing
  - should return a frozen config object
  - should throw ConfigLoadError when config file does not exist
  - should throw ConfigLoadError on invalid JSON
  - should throw ConfigLoadError when repoPath has no .git directory

## Test Files Modified
- (none)

## Test Files Created
- tests/config-loader-agent.test.ts

## Coverage Notes
- Tests mock both `src/util/fs.js` (for `exists`) and `node:fs/promises` (for `readFile`) to avoid touching the real filesystem.
- The existing tests in `tests/config-loader-overrides.test.ts` and `tests/config-schema.test.ts` still pass (53 tests).
