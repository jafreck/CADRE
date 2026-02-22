# Test Result: task-003 - Create src/cli/init.ts

## Tests Written
- `tests/init.test.ts`: 18 new test cases
  - should throw an error when .git does not exist
  - should include the path in the error message when not a git repo
  - should proceed when .git exists
  - should skip the overwrite prompt and overwrite when --yes is true
  - should prompt for overwrite when --yes is false
  - should abort without writing when user declines overwrite
  - should write config when user confirms overwrite
  - should call runPrompts with the yes option
  - should write cadre.config.json with content that passes schema validation
  - should write cadre.config.json to the correct path
  - should create .github/agents/ directory
  - should use issueMode=ids to build issues.ids config
  - should use issueMode=query to build issues.query config
  - should create .gitignore with .cadre/ when it does not exist
  - should append .cadre/ to existing .gitignore that does not contain it
  - should not write .gitignore when .cadre/ is already present
  - should not write .gitignore when line exactly matches .cadre/ (no trailing newline)
  - should use process.cwd() when repoPath is not provided

## Test Files Modified
- (none)

## Test Files Created
- tests/init.test.ts

## Coverage Notes
- All mocks use `vi.mock()` following the same pattern as `tests/prompts.test.ts`
- `CadreConfigSchema.parse()` is exercised with real schema validation (not mocked), so invalid prompt answers would cause test failures
- The chalk import is not mocked; chalk output is suppressed via `console.log` spy
- All 18 tests pass with `npx vitest run tests/init.test.ts`
