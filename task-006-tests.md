# Test Result: task-006 - Write Tests for src/cli/init.ts

## Tests Written
- `tests/cli-init.test.ts`: 6 test cases
  - throws when .git is absent
  - writes cadre.config.json parseable by CadreConfigSchema.parse()
  - creates .github/agents/ directory
  - adds .cadre/ to .gitignore when no .gitignore exists
  - preserves existing .gitignore content when appending .cadre/
  - does not duplicate .cadre/ when already present in .gitignore

## Test Files Modified
- (none)

## Test Files Created
- tests/cli-init.test.ts

## Coverage Notes
- All acceptance criteria are covered: git repo validation, config schema validation, .gitignore creation/append/dedup, and .github/agents/ directory creation
- `src/cli/prompts.js` is mocked to avoid interactive prompts; real fs I/O is used via temp directories
- The `--yes` flag path (skipping prompts) is exercised; the interactive prompt path is not tested as it requires user input
- All 6 tests pass with `npx vitest run tests/cli-init.test.ts`
