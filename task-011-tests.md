# Test Result: task-011 - Fill in `integration-checker.md` template

## Tests Written
- `tests/integration-checker-template.test.ts`: 21 new test cases
  - should start with a # Integration Checker heading
  - should have at least 30 non-empty lines of content
  - (input contract) should describe commands from config as input
  - (input contract) should mention install command
  - (input contract) should mention build command
  - (input contract) should mention test command
  - (input contract) should mention optional lint command
  - (commands to run) should specify npm install
  - (commands to run) should specify npm run build
  - (commands to run) should specify npx vitest run
  - (exit code interpretation) should explain that exit code 0 means success
  - (exit code interpretation) should explain that non-zero exit codes mean failure
  - (output contract) should describe IntegrationReport as the output structure
  - (output contract) should include buildResult in the output
  - (output contract) should include testResult in the output
  - (output contract) should include lintResult in the output
  - (output contract) should include overallPass in the output
  - (output contract) should include summary in the output
  - (output contract) should specify overallPass is true only when all steps pass
  - (output contract) should allow lintResult to be null when no lint command is configured
  - (tool permissions) should mention bash as a permitted tool

## Test Files Modified
- (none)

## Test Files Created
- tests/integration-checker-template.test.ts

## Coverage Notes
- Tests verify structural content of the markdown template (headings, key terms, JSON field names)
- Runtime behavior of the agent (actual command execution) cannot be unit-tested as it requires a live agent environment
