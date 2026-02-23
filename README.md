# CADRE — Coordinated Agent Development Runtime Engine

CADRE is a framework for **parallel agent-based software development** against a set of open GitHub issues. Given a repository and a list of issues, CADRE provisions one git worktree per issue, then orchestrates a coordinated team of single-purpose agents within each worktree to analyze the issue, plan the implementation, write code, write tests, verify correctness, and open a pull request — all in parallel across issues, with checkpointing and resume at every level.

## Quick Start

```bash
npm install
npm run build

# Create a cadre.config.json in your repo
npx cadre run -c path/to/cadre.config.json

# Resume from last checkpoint
npx cadre run -c path/to/cadre.config.json --resume

# Check progress
npx cadre status -c path/to/cadre.config.json

# List active worktrees
npx cadre worktrees -c path/to/cadre.config.json
```

## Configuration

Create a `cadre.config.json`:

```json
{
  "projectName": "my-project",
  "repository": "owner/repo",
  "repoPath": "/path/to/local/clone",
  "baseBranch": "main",
  "issues": {
    "ids": [42, 57, 61]
  },
  "options": {
    "maxParallelIssues": 3,
    "maxParallelAgents": 3
  },
  "commands": {
    "install": "npm install",
    "build": "npm run build",
    "test": "npm test"
  },
  "github": {
    "auth": {
      "appId": "12345",
      "installationId": "67890",
      "privateKeyFile": "/path/to/private-key.pem"
    }
  }
}
```

### GitHub MCP Server

CADRE uses the [GitHub MCP server](https://github.com/github/github-mcp-server) for all GitHub interactions (issues, pull requests, comments) and authenticates as a **GitHub App**.

Install the server:

```bash
brew install github/gh-mcp/github-mcp-server
```

### GitHub App Authentication

CADRE authenticates to GitHub as a [GitHub App](https://docs.github.com/en/apps). You need:

1. A registered GitHub App with permissions for issues (read/write) and pull requests (read/write)
2. The App installed on the target repository or organization
3. The App's private key file (`.pem`)

Configure in `cadre.config.json`:

```json
{
  "github": {
    "auth": {
      "appId": "12345",
      "installationId": "67890",
      "privateKeyFile": "/path/to/private-key.pem"
    }
  }
}
```

Values support `${ENV_VAR}` syntax to reference host environment variables:

```json
{
  "github": {
    "auth": {
      "appId": "${CADRE_GITHUB_APP_ID}",
      "installationId": "${CADRE_GITHUB_INSTALLATION_ID}",
      "privateKeyFile": "${CADRE_GITHUB_PRIVATE_KEY_FILE}"
    }
  }
}
```

### Claude CLI Setup

CADRE supports [Claude CLI](https://docs.anthropic.com/en/docs/claude-cli) (`claude`) as an alternative agent backend alongside the default GitHub Copilot CLI.

**Install the Claude CLI:**

```bash
npm install -g @anthropic-ai/claude-code
```

**Authenticate:**

```bash
claude login
```

This opens a browser to authenticate with your Anthropic account. Alternatively, set the `ANTHROPIC_API_KEY` environment variable:

```bash
export ANTHROPIC_API_KEY=sk-ant-...
```

**Configure CADRE to use Claude:**

Set `agent.backend` to `"claude"` in `cadre.config.json`:

```json
{
  "projectName": "my-project",
  "repository": "owner/repo",
  "repoPath": "/path/to/local/clone",
  "baseBranch": "main",
  "issues": {
    "ids": [42, 57, 61]
  },
  "agent": {
    "backend": "claude",
    "model": "claude-opus-4-5",
    "timeout": 600000,
    "claude": {
      "cliCommand": "claude"
    }
  }
}
```

**`agent` config reference:**

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `agent.backend` | `"copilot"` \| `"claude"` | `"copilot"` | Which AI backend to use for agent invocations |
| `agent.model` | string | backend default | Model identifier (overrides the backend's default model) |
| `agent.timeout` | number (ms) | backend default | Timeout in milliseconds for agent invocations |
| `agent.claude.cliCommand` | string | `"claude"` | Path or name of the `claude` CLI executable |

## CI Usage

You can run CADRE in GitHub Actions using the example workflow at [`.github/workflows/cadre-example.yml`](.github/workflows/cadre-example.yml).

### Authentication Options

**Option 1 — PAT Token**

Use a personal access token stored as a repository secret:

```json
{
  "github": {
    "auth": {
      "token": "${GITHUB_TOKEN}"
    }
  }
}
```

```yaml
- name: Run CADRE
  env:
    GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
  run: npx cadre run -c cadre.config.json
```

**Option 2 — GitHub App**

Use a registered GitHub App for authentication:

```json
{
  "github": {
    "auth": {
      "appId": "${CADRE_GITHUB_APP_ID}",
      "installationId": "${CADRE_GITHUB_INSTALLATION_ID}",
      "privateKeyFile": "${CADRE_GITHUB_PRIVATE_KEY_FILE}"
    }
  }
}
```

```yaml
- name: Run CADRE
  env:
    CADRE_GITHUB_APP_ID: ${{ secrets.CADRE_GITHUB_APP_ID }}
    CADRE_GITHUB_INSTALLATION_ID: ${{ secrets.CADRE_GITHUB_INSTALLATION_ID }}
    CADRE_GITHUB_PRIVATE_KEY_FILE: ${{ secrets.CADRE_GITHUB_PRIVATE_KEY_FILE }}
  run: npx cadre run -c cadre.config.json
```

**Required GitHub App permissions:**

| Permission | Access |
|------------|--------|
| Issues | Read |
| Pull Requests | Write |
| Contents | Write |

### `repoPath` in CI

Set `repoPath` to the GitHub Actions workspace so CADRE uses the checked-out repository:

```json
{
  "repoPath": "${GITHUB_WORKSPACE}"
}
```

Or inline in the workflow:

```yaml
- name: Configure CADRE
  run: |
    jq '.repoPath = env.GITHUB_WORKSPACE' cadre.config.json > tmp.json && mv tmp.json cadre.config.json
```

See [`.github/workflows/cadre-example.yml`](.github/workflows/cadre-example.yml) for a complete end-to-end example.

## CI Usage

CADRE can run inside a GitHub Actions workflow to automatically process issues on a schedule or on demand.

An example workflow is provided at [`.github/workflows/cadre-example.yml`](.github/workflows/cadre-example.yml).

### Authentication in CI

CADRE supports two authentication modes when running in CI:

#### Option 1: PAT Token (Personal Access Token)

Set a GitHub PAT as a secret and pass it via the `GITHUB_TOKEN` environment variable. In `cadre.config.json`, omit the `github.auth` block so CADRE falls back to the ambient token:

```json
{
  "projectName": "my-project",
  "repository": "owner/repo",
  "repoPath": "${{ github.workspace }}"
}
```

In your workflow:

```yaml
- name: Run CADRE
  env:
    GITHUB_TOKEN: ${{ secrets.CADRE_PAT }}
  run: npx cadre run -c cadre.config.json
```

#### Option 2: GitHub App

Store the App credentials as secrets and reference them via `${ENV_VAR}` in `cadre.config.json`:

```json
{
  "github": {
    "auth": {
      "appId": "${CADRE_GITHUB_APP_ID}",
      "installationId": "${CADRE_GITHUB_INSTALLATION_ID}",
      "privateKeyFile": "${CADRE_GITHUB_PRIVATE_KEY_FILE}"
    }
  }
}
```

In your workflow, write the private key to a temp file and set the env vars:

```yaml
- name: Write GitHub App private key
  run: echo "${{ secrets.CADRE_GITHUB_PRIVATE_KEY }}" > /tmp/cadre-key.pem

- name: Run CADRE
  env:
    CADRE_GITHUB_APP_ID: ${{ secrets.CADRE_GITHUB_APP_ID }}
    CADRE_GITHUB_INSTALLATION_ID: ${{ secrets.CADRE_GITHUB_INSTALLATION_ID }}
    CADRE_GITHUB_PRIVATE_KEY_FILE: /tmp/cadre-key.pem
  run: npx cadre run -c cadre.config.json
```

**Required GitHub App permissions:**

| Permission | Access |
|------------|--------|
| Issues | Read |
| Pull Requests | Write |
| Contents | Write |

### `repoPath` in CI

Set `repoPath` to the GitHub Actions workspace so CADRE operates on the checked-out repository:

```json
{
  "repoPath": "${{ github.workspace }}"
}
```

Or use an environment variable:

```json
{
  "repoPath": "${GITHUB_WORKSPACE}"
}
```

## Architecture

CADRE processes issues through a 5-phase pipeline:

1. **Analysis & Scouting** — Understand the issue and locate relevant code
2. **Planning** — Break the issue into implementation tasks with dependencies
3. **Implementation** — Execute tasks with code-writer, test-writer, and code-reviewer agents
4. **Integration Verification** — Run build and tests to verify correctness
5. **PR Composition** — Generate and create a pull request

Each issue runs in its own git worktree with full isolation. Multiple issues are processed in parallel up to a configurable concurrency limit.

### Agent Roster

| Agent | Purpose |
|-------|---------|
| `issue-analyst` | Analyze issue requirements and scope |
| `codebase-scout` | Locate relevant files in the codebase |
| `implementation-planner` | Plan implementation as dependency-aware tasks |
| `adjudicator` | Choose between competing plans |
| `code-writer` | Implement code changes |
| `test-writer` | Write tests for changes |
| `code-reviewer` | Review changes for correctness |
| `fix-surgeon` | Fix issues found by review or tests |
| `integration-checker` | Verify build and test pass |
| `pr-composer` | Compose PR title and body |

## CLI Commands

- `cadre run` — Process issues with agent pipelines
- `cadre status` — Show fleet and issue progress
- `cadre reset` — Reset fleet or issue state
- `cadre worktrees` — List or manage active worktrees

## Key Design Principles

1. **No AI logic in the runtime** — The runtime manages processes, git, and files. Intelligence lives in agent prompts.
2. **File-based IPC** — Agents communicate through files, not APIs.
3. **Worktree isolation** — Each issue gets its own git worktree. No cross-contamination.
4. **Idempotent resume** — Safe to run `--resume` repeatedly.
5. **Git operations are the runtime's job** — Agents write files; the runtime handles git.
6. **MCP-native GitHub access** — GitHub interactions use the MCP protocol, not CLI wrappers.

## License

MIT
