# Test Result: task-005 - Fill in `implementation-planner.md` template

## Tests Written
- `tests/implementation-planner-template.test.ts`: 14 test cases
  - should start with a # Implementation Planner heading
  - should have at least 40 lines of content
  - (input contract) should describe analysis.md as an input file
  - (input contract) should describe scout-report.md as an input file
  - (output contract) should describe implementation-plan.md as the output file
  - (output contract) should describe task IDs with task-XXX pattern
  - (output contract) should describe dependencies field
  - (output contract) should describe complexity field
  - (output contract) should describe acceptance criteria field
  - (output contract) should specify the exact ImplementationTask interface fields
  - (tool permissions) should mention read files permission
  - (example task block) should include at least one example task block
  - (example task block) example should contain a task-001 heading
  - (example task block) example should include Description, Files, Dependencies, Complexity, and Acceptance Criteria

## Test Files Modified
- (none)

## Test Files Created
- tests/implementation-planner-template.test.ts

## Coverage Notes
- Tests verify structural content of the markdown template (headings, sections, field names) but cannot verify semantic correctness of the prompt instructions.
- All 14 tests pass.
