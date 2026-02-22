# Fix Result: task-010

## Fix Type
review-issues

## Fixes Applied
### Fix 1: Rename `url` to `webhookUrl` in Slack provider example
**File:** `cadre.config.json`
**Issue:** The Slack provider entry used `"url"` but `SlackProvider` reads `config.webhookUrl`, causing silent broken notifications if copied by users.
**Fix:** Renamed `"url"` to `"webhookUrl"` on line 64 of `cadre.config.json`.

## Files Modified
- cadre.config.json

## Verification Notes
- Verify `cadre.config.json` is valid JSON (`node -e "require('./cadre.config.json')"`)
- Confirm the Slack provider entry now has `"webhookUrl": "${SLACK_WEBHOOK_URL}"` (no `"url"` field)
- Run `npm run build && npx vitest run` to ensure no regressions
