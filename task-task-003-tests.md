# Test Result: task-003 - Fill in `issue-analyst.md` template

## Tests Written
- `tests/issue-analyst-template.test.ts`: 12 new test cases
  - should start with a # Issue Analyst heading
  - should have at least 30 lines of content
  - should describe the issue number as input
  - should describe repository context as input
  - should describe a Requirements output section
  - should describe a Change Type output section
  - should describe a Scope Estimate output section
  - should describe an Affected Areas output section
  - should describe an Ambiguities output section
  - should mention GitHub issue read permission
  - should mention code search permission
  - should include at least one example output section

## Test Files Modified
- (none)

## Test Files Created
- tests/issue-analyst-template.test.ts

## Coverage Notes
- All 12 tests pass against the current issue-analyst.md implementation.
- Tests follow the same pattern as cadre-runner-template.test.ts and issue-orchestrator-template.test.ts.
