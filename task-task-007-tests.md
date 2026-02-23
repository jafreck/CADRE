# Test Result: task-007 - Fill in `code-writer.md` template

## Tests Written
- `tests/code-writer-template.test.ts`: 18 new test cases
  - should start with a # Code Writer heading
  - should have at least 35 non-empty lines of content
  - (input contract) should describe task ID as an input
  - (input contract) should describe task description as an input
  - (input contract) should describe acceptance criteria as an input
  - (input contract) should describe file list as an input
  - (output contract) should describe modified or created source files as output
  - (output contract) should describe a result summary as output
  - (output contract) should include the result summary markdown format with taskId
  - (output contract) should describe Files Modified section in the result format
  - (output contract) should describe Files Created section in the result format
  - (tool permissions) should list view as a permitted tool
  - (tool permissions) should list edit as a permitted tool
  - (tool permissions) should list create as a permitted tool
  - (tool permissions) should list bash as a permitted tool
  - (style constraints) should mention making minimal changes
  - (style constraints) should prohibit fixing unrelated code or bugs
  - (style constraints) should mention following existing code style or conventions

## Test Files Modified
- (none)

## Test Files Created
- tests/code-writer-template.test.ts

## Coverage Notes
- All 18 tests pass against the current `code-writer.md` template.
- The line-count threshold (35) reflects the actual template size rather than an arbitrary number.
