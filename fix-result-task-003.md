# Fix Result: task-003

## Fix Type
review-issues

## Fixes Applied

### Fix 1: `--yes` mode now skips non-essential prompts
**File:** `src/cli/prompts.ts`
**Issue:** `repoPath`, `baseBranch`, and `issueMode` prompts were always shown interactively, even when `yes === true`, blocking `cadre init --yes`.
**Fix:** Added conditional branches — when `yes === true`, each field uses its documented default (`repoPath` → `process.cwd()`, `baseBranch` → `'main'`, `issueMode` → `{ mode: 'query', state: 'open', limit: 10 }`) without prompting.

### Fix 2: `opts.repoPath` CLI flag is now passed through to config assembly
**File:** `src/cli/init.ts` and `src/cli/prompts.ts`
**Issue:** `runInit` validated `opts.repoPath` for `.git` presence but never forwarded it to `collectAnswers`, so it was silently ignored in the written config.
**Fix:** Updated `collectAnswers` signature to accept an optional `repoPathOverride` parameter and updated `runInit` to call `collectAnswers(opts.yes, opts.repoPath)`. The override is used as the automatic value in `--yes` mode and as the prompt default otherwise.

### Fix 3: Silent overwrite now logs a notice
**File:** `src/cli/init.ts`
**Issue:** When `--yes` caused an existing `cadre.config.json` to be silently overwritten, no message was shown.
**Fix:** Added `chalk.yellow('Overwriting existing cadre.config.json...')` log in the `else` branch of the overwrite check.

### Fix 4: Updated tests to match new `collectAnswers` signature
**File:** `tests/init.test.ts`
**Issue:** Two test assertions checked `mockCollectAnswers` was called with only `(true)` / `(false)`, but the function now receives the `repoPath` as a second argument.
**Fix:** Updated both assertions to `toHaveBeenCalledWith(true, REPO_PATH)` and `toHaveBeenCalledWith(false, REPO_PATH)` respectively.

## Files Modified
- `src/cli/prompts.ts`
- `src/cli/init.ts`
- `tests/init.test.ts`

## Verification Notes
- `npm run build` succeeds with no TypeScript errors
- `npx vitest run` passes all 214 tests that were previously passing; the 1 remaining failure (`github-issues.test.ts`) is pre-existing and unrelated to these changes
