# Test Result: task-002 - Create src/cli/prompts.ts

## Tests Written
- `tests/prompts.test.ts`: 17 new test cases

### --yes mode (non-interactive) — 9 tests
- should return defaults without throwing
- should derive repository and projectName from git remote (HTTPS)
- should derive repository and projectName from git remote (SSH)
- should use first remote when no origin found
- should return empty strings and warn when no git remote available
- should return empty strings and warn when simple-git throws
- should set repoPath to process.cwd()
- should not call any @inquirer/prompts functions
- should sanitize project name (replace non-alphanumeric with hyphens)

### interactive mode (yes: false) — 7 tests
- should return typed PromptAnswers with all required fields
- should omit commands when all command confirms are false
- should collect commands when confirms are true
- should skip github auth prompt for azure-devops platform
- should validate project name inline (rejects invalid names)
- should validate repository as owner/repo for github platform
- should validate repo path checks for .git directory

### PromptAnswers interface — 1 test
- should export PromptAnswers as a type

## Test Files Modified
- (none)

## Test Files Created
- tests/prompts.test.ts

## Coverage Notes
- Interactive prompts are tested by capturing the `validate` callbacks passed to `@inquirer/prompts` mocks, allowing validation logic to be exercised without a real TTY.
- The `parseRemoteUrl` and `tryGetRemoteInfo` private functions are tested indirectly via `runPrompts({ yes: true })` with a mocked `simple-git`.
- Azure DevOps repository validation (non-empty string) is not directly tested as the `Repository:` prompt message differs from the GitHub case and would require additional mock branching; the platform-switching behaviour is covered by the azure-devops skip-auth test.
