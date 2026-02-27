# cadre.config.json Schema Reference

All fields are optional unless marked **required**.

---

## Top-level fields

| Field | Type | Required | Default | Description |
|---|---|---|---|---|
| `projectName` | `string` | ✓ | — | Human-readable project name used for directory naming. Lowercase alphanumeric and hyphens only (`^[a-z0-9-]+$`). |
| `platform` | `"github" \| "azure-devops"` | | `"github"` | Issue-tracking and PR platform. |
| `repository` | `string` | ✓ | — | Repository identifier. GitHub: `"owner/repo"`. Azure DevOps: `"project/repo"` or just the repo name. |
| `repoPath` | `string` | ✓ | — | Path to the local clone of the repository (the main worktree). Use `"."` when running from the repo root. |
| `baseBranch` | `string` | | `"main"` | Branch that issue worktrees are created from. |
| `worktreeRoot` | `string` | | `.cadre/worktrees/` | Directory where per-issue git worktrees are placed. |
| `branchTemplate` | `string` | | `"cadre/issue-{issue}"` | Branch naming template. Supports `{issue}` (issue number) and `{title}` (slugified title) placeholders. |

---

## `issues`

Selects which issues to work on. Provide **one** of the two forms below.

### Explicit IDs

```json
"issues": {
  "ids": [42, 43, 44]
}
```

| Field | Type | Description |
|---|---|---|
| `ids` | `number[]` | Exact issue numbers to process. |

### Query

```json
"issues": {
  "query": {
    "state": "open",
    "labels": ["dogfooding"],
    "limit": 20
  }
}
```

| Field | Type | Default | Description |
|---|---|---|---|
| `state` | `"open" \| "closed" \| "all"` | `"open"` | Filter by issue state. |
| `labels` | `string[]` | — | Filter to issues that have **all** of these labels. |
| `milestone` | `string` | — | Filter by milestone title. |
| `assignee` | `string` | — | Filter by assignee login. |
| `limit` | `number` (1–100) | `10` | Maximum number of issues to return. |

---

## `commits`

| Field | Type | Default | Description |
|---|---|---|---|
| `conventional` | `boolean` | `true` | Use [Conventional Commits](https://www.conventionalcommits.org/) format (`feat:`, `fix:`, etc.). |
| `sign` | `boolean` | `false` | Sign commits with GPG. |
| `commitPerPhase` | `boolean` | `true` | Commit after each completed pipeline phase. |
| `squashBeforePR` | `boolean` | `false` | Squash all phase commits into a single commit before opening the PR. |

---

## `pullRequest`

| Field | Type | Default | Description |
|---|---|---|---|
| `autoCreate` | `boolean` | `true` | Automatically open a PR when the issue pipeline completes. |
| `autoComplete` | `boolean \| { enabled?: boolean, merge_method?: "merge" \| "squash" \| "rebase" }` | `false` | Auto-complete issue PRs after creation/update. Boolean `true` defaults to squash; object form lets you choose `merge_method`. |
| `draft` | `boolean` | `true` | Open the PR as a draft. |
| `labels` | `string[]` | `["cadre-generated"]` | Labels to apply to the PR. |
| `reviewers` | `string[]` | `[]` | GitHub/ADO usernames to request reviews from. |
| `linkIssue` | `boolean` | `true` | Add a `Closes #N` footer to the PR body to auto-close the issue on merge. |

---

## `options`

| Field | Type | Default | Description |
|---|---|---|---|
| `maxParallelIssues` | `number` (1–20) | `3` | Maximum number of issues processed simultaneously (each in its own worktree). |
| `maxParallelAgents` | `number` (1–10) | `3` | Maximum agents running in parallel within a single issue pipeline. |
| `maxRetriesPerTask` | `number` (1–5) | `3` | Retries before marking a task as blocked. |
| `tokenBudget` | `number` | — | Total token cap across all issues. Omit for no cap. |
| `perIssueTokenBudget` | `number` | — | Per-issue token cap. Omit for no cap. |
| `dryRun` | `boolean` | `false` | Analyze and plan only — no code changes, commits, or PRs. |
| `resume` | `boolean` | `false` | Resume from the last checkpoint instead of starting fresh. |
| `invocationDelayMs` | `number` | `0` | Delay in milliseconds between agent invocations (rate-limiting). |
| `buildVerification` | `boolean` | `true` | Run `commands.build` after the implementation phase to verify compilation. |
| `testVerification` | `boolean` | `true` | Run `commands.test` after the implementation phase to verify tests pass. |
| `perTaskBuildCheck` | `boolean` | `true` | Run a build check after each individual task completes. |
| `maxBuildFixRounds` | `number` (1–5) | `2` | Maximum fix-surgeon rounds per failing per-task build check. |
| `maxIntegrationFixRounds` | `number` (1–5) | `1` | Maximum fix-surgeon rounds per failing end-of-phase build/test command. |
| `skipValidation` | `boolean` | `false` | Skip pre-run validation checks (agent files, git state, etc.). |
| `ambiguityThreshold` | `number` | `5` | Number of ambiguous tasks required to trigger the ambiguity gate. |
| `haltOnAmbiguity` | `boolean` | `false` | Halt the pipeline when the ambiguity gate fires instead of continuing. |

---

## `commands`

Shell commands executed inside the issue worktree.

| Field | Type | Description |
|---|---|---|
| `install` | `string` | Dependency installation command, run once per worktree (e.g. `"npm install"`). |
| `build` | `string` | Build/compile command (e.g. `"npm run build"`). |
| `test` | `string` | Test command (e.g. `"npx vitest run"`). |
| `lint` | `string` | Lint command (optional). |

---

## `copilot`

Controls the GitHub Copilot CLI backend.

| Field | Type | Default | Description |
|---|---|---|---|
| `cliCommand` | `string` | `"copilot"` | Executable name for the Copilot CLI. |
| `model` | `string` | `"claude-sonnet-4.6"` | Model identifier passed to the Copilot CLI. |
| `agentDir` | `string` | `".github/agents"` | Directory containing `.md` agent files. |
| `timeout` | `number` | `300000` | Timeout in milliseconds for a single agent invocation. |
| `costOverrides` | `Record<string, { input: number, output: number }>` | — | Per-model cost overrides ($/1K tokens) for token budget accounting. Keys are model names. |

---

## `agent`

Advanced agent backend configuration. When omitted cadre uses the `copilot` backend with defaults.

| Field | Type | Default | Description |
|---|---|---|---|
| `backend` | `"copilot" \| "claude"` | `"copilot"` | AI backend for agent invocations. |
| `model` | `string` | — | Model identifier override (takes precedence over backend-specific default). |
| `timeout` | `number` | — | Timeout in ms override for all agents. |
| `copilot.cliCommand` | `string` | `"copilot"` | Copilot CLI executable. |
| `copilot.agentDir` | `string` | `".github/agents"` | Agent file directory. |
| `copilot.costOverrides` | `Record<string, { input, output }>` | — | Per-model cost overrides. |
| `claude.cliCommand` | `string` | `"claude"` | Claude CLI executable. |

---

## `environment`

| Field | Type | Default | Description |
|---|---|---|---|
| `inheritShellPath` | `boolean` | `true` | Pass the current `PATH` to agent subprocesses. |
| `shell` | `string` | — | Shell to use for command execution (e.g. `"/bin/zsh"`). |
| `extraPath` | `string[]` | `[]` | Additional directories prepended to `PATH` for agent subprocesses. |

---

## `github`

GitHub-specific configuration. Required when `platform` is `"github"`. If omitted cadre auto-detects `GITHUB_TOKEN` from the environment and uses `github-mcp-server stdio` as the MCP server.

### `github.mcpServer`

| Field | Type | Default | Description |
|---|---|---|---|
| `command` | `string` | `"github-mcp-server"` | Command to launch the GitHub MCP server. |
| `args` | `string[]` | `["stdio"]` | Arguments for the server command. |

### `github.auth`

Provide **one** of the two forms:

**Token (PAT or `gh auth token`)**
```json
"auth": { "token": "${GITHUB_TOKEN}" }
```

**GitHub App (for CI / org-level access)**
```json
"auth": {
  "appId": "123456",
  "installationId": "78901234",
  "privateKeyFile": "/path/to/private-key.pem"
}
```

All values support `${ENV_VAR}` substitution.

---

## `azureDevOps`

Required when `platform` is `"azure-devops"`. Omit for GitHub.

| Field | Type | Description |
|---|---|---|
| `organization` | `string` | Azure DevOps organization name. |
| `project` | `string` | Azure DevOps project name. |
| `repositoryName` | `string` | Repository name within the project (defaults to the project name). |
| `auth.pat` | `string` | Personal Access Token. Supports `${ENV_VAR}` syntax. |

---

## `issueUpdates`

Controls which lifecycle events post comments back to the GitHub/ADO issue.

| Field | Type | Default | Description |
|---|---|---|---|
| `enabled` | `boolean` | `true` | Master switch — disables all issue comments when `false`. |
| `onStart` | `boolean` | `true` | Post a comment when the pipeline starts. |
| `onPhaseComplete` | `boolean` | `false` | Post a comment after each phase completes. |
| `onComplete` | `boolean` | `true` | Post a comment when the pipeline succeeds. |
| `onFailed` | `boolean` | `true` | Post a comment when the pipeline fails. |
| `onBudgetWarning` | `boolean` | `true` | Post a comment when approaching the token budget limit. |

---

## `notifications`

Out-of-band notifications sent independently of issue comments.

| Field | Type | Default | Description |
|---|---|---|---|
| `enabled` | `boolean` | `false` | Enable the notifications subsystem. |
| `providers` | `Provider[]` | `[]` | List of notification provider configs (see below). |

### Provider types

**`webhook`**
```json
{ "type": "webhook", "url": "${WEBHOOK_URL}", "events": ["issue.completed"] }
```

**`slack`**
```json
{ "type": "slack", "webhookUrl": "${SLACK_WEBHOOK_URL}", "channel": "#builds", "events": ["fleet.completed", "issue.failed"] }
```

**`log`**
```json
{ "type": "log", "logFile": ".cadre/notifications.log" }
```

| Field | Type | Description |
|---|---|---|
| `type` | `"webhook" \| "slack" \| "log"` | Provider type. |
| `url` | `string` | Webhook URL (`webhook` provider). Supports `${ENV_VAR}`. |
| `webhookUrl` | `string` | Webhook URL (`slack` provider). Supports `${ENV_VAR}`. |
| `channel` | `string` | Slack channel (`slack` provider). |
| `logFile` | `string` | Log file path (`log` provider). |
| `events` | `string[]` | Events to subscribe to. Omit to receive all events. Common values: `issue.completed`, `issue.failed`, `fleet.completed`. |

---

## `dogfood`

Self-reporting mode — when enabled, CADRE automatically creates GitHub issues in its own repository when it encounters runtime problems.

| Field | Type | Default | Description |
|---|---|---|---|
| `enabled` | `boolean` | `false` | Enable dogfood mode. When `true`, runtime events create issues in the configured repository. |
| `maxIssuesPerRun` | `number` (≥ 1) | `5` | Maximum number of issues to create per run to prevent spam. |
| `labels` | `string[]` | `["cadre-dogfood"]` | Labels applied to every dogfood issue. |
| `titlePrefix` | `string` | `"[CADRE Dogfood]"` | Prefix prepended to dogfood issue titles. |

```json
"dogfood": {
  "enabled": true,
  "maxIssuesPerRun": 3,
  "labels": ["cadre-dogfood", "bug"],
  "titlePrefix": "[CADRE Dogfood]"
}
```

---

## Minimal example

```json
{
  "projectName": "my-app",
  "repository": "myorg/my-app",
  "repoPath": ".",
  "issues": { "ids": [12, 15] },
  "commands": {
    "build": "npm run build",
    "test": "npm test"
  }
}
```

## Full example

See [`cadre.config.json`](../cadre.config.json) in the repository root for a complete working example.
