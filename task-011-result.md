# Task Result: task-011 - Fill in `integration-checker.md` template

## Changes Made
- `src/agents/templates/integration-checker.md`: Replaced 4-line stub with a full system prompt including role, input contract, commands to run, exit code interpretation, and structured output contract (IntegrationReport)

## Files Modified
- src/agents/templates/integration-checker.md

## Files Created
- (none)

## Notes
- Template describes running `npm install`, `npm run build`, `npx vitest run` in order
- Output contract defines `IntegrationReport` with `buildResult`, `testResult`, `lintResult`, `overallPass`, and `summary`
- All 21 `agent-templates.test.ts` tests pass
