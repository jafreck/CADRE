# Task Result: task-004 - Add `report()` Method to CadreRuntime

## Changes Made
- `src/core/runtime.ts`: Added `report(options)` method and imported `ReportWriter`

## Files Modified
- src/core/runtime.ts

## Files Created
- (none)

## Notes
- `report({})` prints a formatted summary (runId, project, duration, issues, PRs, failures, tokens, cost) for the most recent report file
- `report({ format: 'json' })` prints raw JSON of the most recent report to stdout
- `report({ history: true })` lists all historical report file paths (one per line)
- If `.cadre/reports/` is empty or does not exist, prints "No reports found." gracefully
- Build verified clean with `npm run build`
