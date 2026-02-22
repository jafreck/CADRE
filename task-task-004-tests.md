# Test Result: task-004 - Replace `as` casts in GitHubProvider.parseIssue with type guards

## Tests Written
- `tests/github-provider-parsing.test.ts`: 20 new test cases

  **GitHubProvider – parseIssue type guards (10)**
  - should parse a fully-populated issue
  - should fall back to defaults when numeric fields are missing
  - should fall back to empty string when string fields are absent
  - should fall back to empty string when string fields have wrong type
  - should default to "open" when state is not "closed"
  - should parse state "closed" correctly
  - should produce empty arrays when labels/assignees are absent
  - should omit milestone when raw.milestone is falsy
  - should use "unknown" as comment author fallback when author is absent
  - should handle label objects with non-string name gracefully

  **GitHubProvider – createPullRequest type guards (4)**
  - should parse a full createPullRequest response
  - should fall back to params.title when response title is absent
  - should fall back to url when html_url is absent
  - should default number to 0 when absent from response

  **GitHubProvider – getPullRequest type guards (3)**
  - should parse a full getPullRequest response
  - should default branch refs to empty string when head/base are absent
  - should default branch refs to empty string when head/base are not objects

  **GitHubProvider – listPullRequests type guards (3)**
  - should parse a list of pull requests
  - should produce empty list when API returns empty array
  - should default missing fields to empty string and 0 for each PR

## Test Files Modified
- (none)

## Test Files Created
- tests/github-provider-parsing.test.ts

## Coverage Notes
- The `asRecord`, `asString`, `asNumber`, and `asArray` helpers are module-private; they are tested indirectly through the public `getIssue`, `createPullRequest`, `getPullRequest`, and `listPullRequests` methods.
- The mock MCP client's `callTool` is wired through a real `GitHubAPI` instance so the full parsing pipeline is exercised end-to-end without actual network calls.
- Comment-level parsing (author fallback, body, createdAt) is covered by the `parseIssue` suite.
