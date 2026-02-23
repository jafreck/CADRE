# Test Result: task-003 - Update ResultParser to Extract cadre-json Blocks and Validate Against Schemas

## Tests Written
- `tests/result-parser.test.ts`: 19 new test cases added

  **parseImplementationPlan**
  - should use cadre-json block when present and skip regex
  - should emit deprecation warn when falling back to regex parsing
  - should throw ZodError when cadre-json block fails schema validation
  - should throw when cadre-json block contains invalid JSON

  **parseReview**
  - should use cadre-json block for review when present
  - should emit deprecation warn for review regex fallback
  - should throw ZodError for review cadre-json with invalid verdict

  **parsePRContent**
  - should use cadre-json block for PR content when present
  - should emit deprecation warn for PR content regex fallback
  - should throw ZodError for PR cadre-json missing required fields

  **parseAnalysis**
  - should use cadre-json block for analysis when present
  - should emit deprecation warn for analysis regex fallback
  - should throw ZodError for analysis cadre-json with invalid changeType

  **parseScoutReport**
  - should use cadre-json block for scout report when present
  - should emit deprecation warn for scout report regex fallback
  - should throw ZodError for scout report cadre-json with invalid structure

  **parseIntegrationReport**
  - should use cadre-json block for integration report when present
  - should emit deprecation warn for integration report regex fallback
  - should throw ZodError for integration report cadre-json with invalid structure

## Test Files Modified
- tests/result-parser.test.ts

## Test Files Created
- (none)

## Coverage Notes
- All 6 public parse methods are covered for the cadre-json happy path, deprecation-warn fallback, and ZodError-on-invalid-schema behavior.
- `extractCadreJson` is private and tested indirectly through the public parse methods.
- Invalid JSON in a cadre-json block (SyntaxError) is tested via `parseImplementationPlan`.
- One pre-existing test ("should parse a well-formed implementation plan") was already failing before this task due to a regex acceptance-criteria parsing bug in the fallback path; this is unrelated to the task-003 changes and was not modified.
- 28 of 29 tests pass; the 1 failure is pre-existing and unrelated to the cadre-json extraction feature.
