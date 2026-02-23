# Test Result: task-008 - Fill in `test-writer.md` template

## Tests Written
- `tests/test-writer-template.test.ts`: 18 new test cases
  - should start with a # Test Writer heading
  - should have at least 30 lines of content
  - input contract: should describe task result as input
  - input contract: should describe changed source files as input
  - output contract: should describe test files as output
  - output contract: should specify that tests must pass
  - tool permissions: should mention view permission
  - tool permissions: should mention edit permission
  - tool permissions: should mention create permission
  - tool permissions: should mention bash permission
  - test framework guidance: should specify Vitest as the test framework
  - test framework guidance: should include vitest import example
  - test naming: should describe describe block naming convention
  - test naming: should describe it/test case naming with "should"
  - file placement: should specify test file location under tests/
  - coverage goals: should mention error paths or edge cases
  - coverage goals: should mention public API coverage
  - constraints: should prohibit modifying source files

## Test Files Modified
- (none)

## Test Files Created
- tests/test-writer-template.test.ts

## Coverage Notes
- All 18 tests pass with `npx vitest run tests/test-writer-template.test.ts`
- Follows the same pattern as `issue-analyst-template.test.ts`
- Tests verify structural requirements (heading, line count) and content requirements (input contract, output contract, tool permissions, test framework guidance, naming, file placement, coverage goals, constraints)
