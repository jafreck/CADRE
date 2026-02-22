# Test Result: task-006 - Fill in `adjudicator.md` template

## Tests Written
- `tests/adjudicator-template.test.ts`: 12 new test cases
  - should start with a # Adjudicator heading
  - should have at least 30 lines of content
  - (input contract) should describe competing options as input
  - (input contract) should describe context as input
  - (input contract) should describe constraints as input
  - (output contract) should describe a selected option output
  - (output contract) should describe a rationale output section
  - (decision-making criteria) should include decision-making criteria guidance
  - (decision-making criteria) should mention correctness as a criterion
  - (decision-making criteria) should mention simplicity as a criterion
  - (tool permissions) should mention read file permission
  - (example output) should include at least one example output section

## Test Files Modified
- (none)

## Test Files Created
- tests/adjudicator-template.test.ts

## Coverage Notes
- All 12 tests pass against the current adjudicator.md content
- Tests follow the same pattern as issue-analyst-template.test.ts
