# Test Result: task-004 - Implement Platform Validator and Command Validator

## Tests Written

### `tests/platform-validator.test.ts`: 16 test cases
- should expose the name "platform"
- (github) should return passed:true when github-mcp-server is on PATH and GITHUB_TOKEN is set
- (github) should return passed:false when github-mcp-server is not on PATH
- (github) should return passed:false when no GitHub token is available
- (github) should return passed:true when token is set via config
- (github) should return passed:true when token is set via GITHUB_TOKEN env var (no config token)
- (github) should expand ${ENV_VAR} in config token
- (github) should return passed:false when config token expands to empty string and no GITHUB_TOKEN
- (github) should return passed:false with two errors when both MCP server missing and no token
- (github) should call exec with which and github-mcp-server
- (github) should always return an empty warnings array
- (azure-devops) should return passed:true when PAT is a non-empty direct value
- (azure-devops) should return passed:false when PAT is an empty string
- (azure-devops) should return passed:true when PAT uses ${ENV_VAR} that resolves to a non-empty value
- (azure-devops) should return passed:false when PAT uses ${ENV_VAR} that resolves to empty
- (azure-devops) should not call exec for azure-devops validation

### `tests/command-validator.test.ts`: 14 existing test cases (already present, verified passing)
- should expose the name "command"
- should return passed:true when all configured executables are found on PATH
- should always return an empty warnings array
- should return passed:false when build executable is not found on PATH
- should return passed:false when test executable is not found on PATH
- should check install executable when install is configured
- should check lint executable when lint is configured
- should skip install check when install is not configured
- should skip lint check when lint is not configured
- should return passed:false with error for optional install when not found
- should return passed:false with error for optional lint when not found
- should return multiple errors when multiple executables are missing
- should extract only the first token from a multi-word command as the executable
- should call which with the executable name for each configured command

## Test Files Modified
- (none)

## Test Files Created
- tests/platform-validator.test.ts

## Coverage Notes
- `exec` is mocked via `vi.mock` in both test files — all tests are deterministic with no real PATH or filesystem access.
- `process.env['GITHUB_TOKEN']` and custom env vars are set/cleaned up in `beforeEach`/`afterEach` to avoid test pollution.
- The `platformValidator` has no checks for an unknown platform value (neither github nor azure-devops), so no tests cover that path; it would silently pass with no errors.
- Warnings array is always empty for both validators; coverage is limited to asserting it is present and empty.
