# Task Result: task-003 - Update ResultParser to Extract cadre-json Blocks and Validate Against Schemas

## Changes Made
- `src/agents/result-parser.ts`: Added schema imports from `./schemas/index.js`, added private `extractCadreJson` helper method, and updated all six public parse methods to attempt cadre-json extraction first, validate against Zod schema, and fall back to regex with a deprecation `logger.warn`.

## Files Modified
- src/agents/result-parser.ts

## Files Created
- (none)

## Notes
- `extractCadreJson` extracts the first ` ```cadre-json ``` ` fenced block and parses it as JSON, returning `null` if no block is present.
- Each parse method uses `schema.parse(parsed)` which throws `ZodError` automatically on invalid data — no explicit catch, letting callers handle retries.
- The deprecation warning is emitted via `logger.warn` with a `[deprecated]` prefix identifying the method and file.
- A pre-existing build error in `src/core/issue-orchestrator.ts` (unrelated to this task) was already present before these changes.
