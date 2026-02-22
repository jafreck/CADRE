# Test Result: task-004 - Fill in `codebase-scout.md` template

## Tests Written
- `tests/codebase-scout-template.test.ts`: 16 test cases
  - should have a # Codebase Scout heading
  - should have at least 40 lines of content
  - input contract: should describe the analysis.md input file
  - input contract: should describe the inputFiles field
  - input contract: should describe the outputPath field
  - input contract: should describe the worktreePath field
  - tool permissions: should list glob as a permitted tool
  - tool permissions: should list grep as a permitted tool
  - tool permissions: should list view as a permitted tool
  - output contract: should describe Relevant Files section
  - output contract: should describe Dependency Map section
  - output contract: should describe Test Files section
  - output contract: should describe Estimated Change Surface section
  - output contract: should mention scout-report.md or output report
  - example output: should include at least one example output section
  - example output: example should contain a file table with File and Reason columns

## Test Files Modified
- (none)

## Test Files Created
- tests/codebase-scout-template.test.ts

## Coverage Notes
- All acceptance criteria from task-task-004.md are covered by tests.
- Tests follow the same pattern as cadre-runner-template.test.ts.
