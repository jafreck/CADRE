# Task Result: task-009 - Fill in `code-reviewer.md` template

## Changes Made
- `src/agents/templates/code-reviewer.md`: Replaced 4-line stub with full system prompt including role, input contract, review criteria, and output contract matching the `ReviewResult` interface

## Files Modified
- src/agents/templates/code-reviewer.md

## Files Created
- (none)

## Notes
- Output format matches the `ReviewResult` interface (`verdict: 'pass' | 'needs-fixes'`, `issues[]` with `file`, `line?`, `severity`, `description`, and `summary`)
- Explicitly specifies that only bugs, security issues, and logic errors warrant `needs-fixes`; style/formatting issues are excluded
- All 21 `agent-templates.test.ts` tests pass
