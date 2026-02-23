# Test Result: task-004 - Update ContextBuilder to Include outputSchema in Every Agent Context

## Tests Written
- `tests/context-builder.test.ts`: 10 new test cases in `outputSchema inclusion` describe block
  - should include outputSchema for issue-analyst
  - should include outputSchema for codebase-scout
  - should include outputSchema for implementation-planner
  - should include outputSchema for adjudicator
  - should include outputSchema for code-reviewer
  - should include outputSchema for integration-checker
  - should include outputSchema for pr-composer
  - should NOT include outputSchema for code-writer
  - should NOT include outputSchema for test-writer
  - should NOT include outputSchema for fix-surgeon

## Test Files Modified
- tests/context-builder.test.ts

## Test Files Created
- (none)

## Coverage Notes
- Tests capture the JSON written to disk via the `writeFile` mock to inspect the context payload
- Schema shape/content is not validated beyond type checking (`typeof === 'object'`); the correctness of `zodToJsonSchema` output is assumed to be covered by the zod-to-json-schema library
