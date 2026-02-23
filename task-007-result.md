# Task Result: task-007 - Update ResultParser Tests to Cover cadre-json Extraction and Validation

## Changes Made
- `tests/result-parser.test.ts`: Tests were already present (added by prior session). Verified all 29 tests pass.
- `src/agents/result-parser.ts`: Fixed regex bug in `parseTaskBlock` — removed `m` flag from acceptance criteria regex so `$` matches end-of-string rather than end-of-line, allowing multi-line criteria to be parsed correctly.

## Files Modified
- src/agents/result-parser.ts

## Files Created
- (none)

## Notes
- The test file already contained all required cadre-json happy path tests, ZodError tests, and deprecation warn tests for `parseAnalysis`, `parseReview`, `parsePRContent`, `parseScoutReport`, and `parseIntegrationReport`.
- The pre-existing test `should parse a well-formed implementation plan` was failing due to a regex bug (`m` flag on the criteria pattern caused `$` to match end-of-line instead of end-of-string). Fixed by removing the `m` flag.
- All 29 tests now pass (`npx vitest run`).
