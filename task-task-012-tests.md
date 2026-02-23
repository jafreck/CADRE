# Test Result: task-012 - Fill in `pr-composer.md` template

## Tests Written
- `tests/pr-composer-template.test.ts`: 17 new test cases
  - should start with a # PR Composer heading
  - should have at least 30 lines of content
  - input contract: should describe the issue number as input
  - input contract: should describe task summaries as input
  - input contract: should describe changed files as input
  - output contract: should describe a PRContent output object
  - output contract: should describe a title field
  - output contract: should describe a body field
  - output contract: should describe a labels field
  - output contract: should describe the PR body structure with Summary section
  - output contract: should describe the PR body structure with Changes section
  - output contract: should describe the PR body structure with Testing section
  - tool permissions: should mention view or read file permission
  - tool permissions: should mention bash or git permission
  - style constraints: should mention imperative mood for the title
  - style constraints: should mention a title length limit
  - style constraints: should mention GitHub Flavored Markdown

## Test Files Created
- tests/pr-composer-template.test.ts

## Test Files Modified
- (none)

## Coverage Notes
- All 17 tests pass against the current pr-composer.md content.
- Tests verify structural completeness (heading, line count), input/output contract, tool permissions, and style constraints.
