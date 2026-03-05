# CADRE — Coordinated Agent Development Runtime Engine

[![CI](https://github.com/jafreck/cadre/actions/workflows/ci.yml/badge.svg)](https://github.com/jafreck/cadre/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/@jafreck/cadre)](https://www.npmjs.com/package/@jafreck/cadre)
[![npm downloads](https://img.shields.io/npm/dw/@jafreck/cadre)](https://www.npmjs.com/package/@jafreck/cadre)
[![Coverage](https://img.shields.io/codecov/c/github/jafreck/cadre)](https://codecov.io/gh/jafreck/cadre)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

CADRE is a framework for **parallel agent-based software development** against a set of open GitHub issues. Given a repository and a list of issues, CADRE provisions one git worktree per issue, then orchestrates a coordinated team of single-purpose agents within each worktree to analyze the issue, plan the implementation, write code, write tests, verify correctness, and open a pull request — all in parallel across issues, with checkpointing and resume at every level.

## Quick Start

```bash
npm install -g @jafreck/cadre

# Create a cadre.config.json in your repo
cadre run -c path/to/cadre.config.json

# Resume from last checkpoint
cadre run -c path/to/cadre.config.json --resume

# Check progress
cadre status -c path/to/cadre.config.json

# List active worktrees
cadre worktrees -c path/to/cadre.config.json
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

See [docs/config-schema.md](docs/config-schema.md) for the full schema reference.

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

## Architecture

CADRE processes issues through a 5-phase pipeline:

1. **Analysis & Scouting** — Understand the issue and locate relevant code
2. **Planning** — Break the issue into implementation tasks with dependencies
3. **Implementation** — Execute tasks with code-writer, test-writer, and code-reviewer agents
4. **Integration Verification** — Run build and tests to verify correctness
5. **PR Composition** — Generate and create a pull request

Each issue runs in its own git worktree with full isolation. Multiple issues are processed in parallel up to a configurable concurrency limit.

## Plugin / Extension APIs

Cadre supports runtime extension points without patching core switches:

- `@cadre/agent-runtime`: `registerAgentBackendFactory()` for backend plugins.
- `@cadre/agent-runtime`: `ProviderRegistry` enhancements (`registerProviders`, `describe`, `getCapabilities`, `healthCheck`).
- `@cadre/pipeline-engine`: pluggable `CheckpointStore` with default `FileSystemCheckpointStore`.
- `@cadre/notifications`: `registerNotificationProviderFactory()` for custom notification providers.
- `@cadre/pipeline-engine`: `registerGatePlugin()` for custom phase gates.
- `@cadre/observability`: `FleetEventBus.use()` middleware hooks for event lifecycle interception.
- `src/agents/registry.ts`: `defineAgent()` and registry discovery helpers.

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

When installed globally (`npm install -g @jafreck/cadre`), the `cadre` command is available directly. You can also use `npx @jafreck/cadre` without installing.

## Key Design Principles

1. **No AI logic in the runtime** — The runtime manages processes, git, and files. Intelligence lives in agent prompts.
2. **File-based IPC** — Agents communicate through files, not APIs.
3. **Worktree isolation** — Each issue gets its own git worktree. No cross-contamination.
4. **Idempotent resume** — Safe to run `--resume` repeatedly.
5. **Git operations are the runtime's job** — Agents write files; the runtime handles git.
6. **MCP-native GitHub access** — GitHub interactions use the MCP protocol, not CLI wrappers.

## Flow DSL Package (`@cadre/flow`)

Cadre now includes a framework package for declarative pipeline orchestration graphs.
This package is additive and does not replace the existing app orchestrators yet.
See [docs/flow-dsl.md](docs/flow-dsl.md) for a complete reference.

```ts
import {
  FlowRunner,
  defineFlow,
  step,
  gate,
  loop,
  parallel,
  conditional,
  fromStep,
  fromContext,
} from '@cadre/flow';

const flow = defineFlow('example', [
  step({
    id: 'seed',
    input: fromContext('start'),
    run: (_ctx, input) => Number(input),
  }),
  gate({
    id: 'non-negative',
    input: fromStep('seed'),
    evaluate: (_ctx, value) => Number(value) >= 0,
  }),
  loop({
    id: 'retry-loop',
    maxIterations: 3,
    do: [
      parallel({
        id: 'fan-out',
        concurrency: 2,
        branches: {
          a: [step({ id: 'a-task', run: () => 'a' })],
          b: [step({ id: 'b-task', run: () => 'b' })],
        },
      }),
      conditional({
        id: 'exit-check',
        when: (ctx) => Boolean(ctx.getStepOutput('a-task')),
        then: [step({ id: 'done', run: () => true })],
        else: [step({ id: 'retry', run: () => false })],
      }),
    ],
    until: (ctx) => Boolean(ctx.getStepOutput('done')),
  }),
]);

const runner = new FlowRunner();
await runner.run(flow, { start: 0 });
```

## License

This project is licensed under the [MIT License](LICENSE).

Copyright (c) 2026 Jacob Freck
