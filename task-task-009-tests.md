# Test Result: task-009 - Fill in `code-reviewer.md` template

## Tests Written
- `tests/code-reviewer-template.test.ts`: 19 test cases
  - should start with a # Code Reviewer heading
  - should have at least 30 lines of content
  - input contract: should describe a diff or changed files as input
  - input contract: should mention available tools for investigation
  - output contract: should describe verdict as pass or needs-fixes
  - output contract: should describe an issues array in the output
  - output contract: should describe file field in issues
  - output contract: should describe severity field in issues
  - output contract: should describe description field in issues
  - output contract: should describe line as an optional field
  - output contract: should describe a summary field
  - output contract: should describe severity values error and warning
  - review criteria: should specify that bugs warrant needs-fixes
  - review criteria: should specify that security vulnerabilities warrant needs-fixes
  - review criteria: should specify that logic errors warrant needs-fixes
  - review criteria: should explicitly exclude style and formatting from needs-fixes
  - review criteria: should explicitly exclude naming conventions from needs-fixes
  - ReviewResult interface compliance: should show verdict field in JSON output
  - ReviewResult interface compliance: should show a JSON code block example

## Test Files Modified
- (none)

## Test Files Created
- tests/code-reviewer-template.test.ts

## Coverage Notes
- Tests verify the markdown content structure and presence of required fields, following the same pattern as other template tests (adjudicator-template.test.ts, code-writer-template.test.ts)
- All 19 tests pass
