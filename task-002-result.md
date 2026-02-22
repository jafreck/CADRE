# Task Result: task-002 - Create src/cli/prompts.ts

## Changes Made
- `src/cli/prompts.ts`: Created new prompts module with `PromptAnswers` interface and `runPrompts` function

## Files Modified
- (none)

## Files Created
- src/cli/prompts.ts

## Notes
- `runPrompts({ yes: false })` uses `@inquirer/prompts` (`input`, `select`, `confirm`) for all interactive prompts
- `runPrompts({ yes: true })` skips interactive prompts and returns defaults, deriving `repository` and `projectName` from the git remote URL via `simple-git` if available; warns when values cannot be derived
- Project name validation enforces `/^[a-z0-9-]+$/` inline in the `input` prompt
- Repository prompt validates `owner/repo` format for GitHub platform and non-empty for Azure DevOps
- Repo path prompt validates that `<path>/.git` exists using `node:fs/promises`
- `PromptAnswers` interface is exported
- Build passes with no TypeScript errors
