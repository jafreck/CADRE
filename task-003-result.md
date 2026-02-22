# Task Result: task-003 - Create src/cli/init.ts

## Changes Made
- `src/cli/init.ts`: Created the main init command logic module exporting `runInit`

## Files Modified
- (none)

## Files Created
- src/cli/init.ts

## Notes
- `runInit` validates `.git` exists in the target directory; throws a descriptive `Error` if not
- Prompts for overwrite confirmation when `cadre.config.json` already exists; skips with `--yes`
- Calls `runPrompts` from `src/cli/prompts.ts` to gather user input
- Assembles and validates config via `CadreConfigSchema.parse()`
- Writes `cadre.config.json` atomically via `atomicWriteJSON`
- Appends `.cadre/` to `.gitignore` (creates it if missing) via `readFileOrNull` + `writeTextFile`
- Creates `.github/agents/` directory via `ensureDir`
- All user-visible output uses `chalk` for coloring
