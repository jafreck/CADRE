# Test Result: task-010 - Fill in `fix-surgeon.md` template

## Tests Written
- `tests/fix-surgeon-template.test.ts`: 15 new test cases
  - should start with a # Fix Surgeon heading
  - should have at least 35 non-empty lines of content
  - input contract: should describe review issues as an input
  - input contract: should describe source files as an input
  - input contract: should mention scout report as background context
  - output contract: should describe fixed source files as output
  - output contract: should describe a fix summary as output
  - output contract: should include a Files Modified section in the fix summary format
  - output contract: should include a Files Created section in the fix summary format
  - tool permissions: should list view as a permitted tool
  - tool permissions: should list edit as a permitted tool
  - tool permissions: should list bash as a permitted tool
  - style constraints: should emphasize fixing only what is flagged
  - style constraints: should prohibit refactoring or reformatting unrelated code
  - style constraints: should mention making minimal or smallest possible changes

## Test Files Modified
- (none)

## Test Files Created
- tests/fix-surgeon-template.test.ts

## Coverage Notes
- All 15 tests pass against the current fix-surgeon.md content
- Follows the same structure and patterns as code-writer-template.test.ts
