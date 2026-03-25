<div align="center">
  <h1>CADRE</h1>
  <p><strong>Coordinated Agent Development Runtime Engine</strong></p>
  <p>Parallel issue-to-PR automation for software teams, plus reusable framework packages for building your own agent workflows.</p>
  <p>
    <a href="https://github.com/jafreck/cadre/actions/workflows/ci.yml"><img src="https://github.com/jafreck/cadre/actions/workflows/ci.yml/badge.svg" alt="CI" /></a>
    <a href="https://www.npmjs.com/package/@cadre-dev/cadre"><img src="https://img.shields.io/npm/v/@cadre-dev/cadre" alt="npm version" /></a>
    <a href="https://www.npmjs.com/package/@cadre-dev/cadre"><img src="https://img.shields.io/npm/dw/@cadre-dev/cadre" alt="npm downloads" /></a>
    <a href="https://codecov.io/gh/jafreck/cadre"><img src="https://img.shields.io/codecov/c/github/jafreck/cadre" alt="Coverage" /></a>
    <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-yellow.svg" alt="License: MIT" /></a>
  </p>
</div>

# Overview
CADRE is automation for software development work that starts with an issue and ends with a verified pull request. It is designed for teams that want to move more work in parallel without giving up the structure of their existing repository, build, test, and review process.

CADRE pulls issues from your issue tracker, plans a dependency graph for optimal implementation ordering, launches a fleet of coordinated, specialized agents in parallel to analyze the requirements, plan the implementation, write the code and tests, and review before submitting a pull request. No longer do you need to manually jump between a dozen different sessions to maximize your AI-leverage, CADRE will handle the parallelization, isolation, and verification at a throughput not achievable manually, with a repeatable pipeline that produces auditable outputs instead of one-off agent sessions.

CADRE also ships with a generic agent orchestration framework that can be used to build any other multi-agent or multi-step systems. The CADRE framework combines workflow orchestration, supports multiple agent runtime backends, checkpointing, notifications, and validation into a system that can reliably coordinate complex work from intake through completion. See [CADRE The Framework](#cadre-the-framework) for more.


## How does it work?

`@cadre-dev/cadre` is opinionated about software delivery because effective teams use a structured process to avoid common pitfalls. They plan before implementing, verify that the result matches the requirements, make sure there is test coverage, and have teammates review the work before it is merged.

CADRE automates that same loop. Instead of manually iterating back and forth with an agent across multiple sessions, CADRE coordinates specialized agents through planning, implementation, testing, verification, and review so work moves through a repeatable pipeline from issue to pull request.

At a high level, CADRE:

- pulls work from your issue tracker
- analyzes the issue and plans an implementation order
- runs specialized agents in parallel inside isolated git worktrees
- writes code and tests, then verifies the results against your build and test commands
- prepares the final change for pull request creation and review

## Artifact Layout

By default, CADRE keeps runtime state outside the target repository under `~/.cadre/<projectName>/`. Worktrees, checkpoints, reports, and per-issue artifacts are stored there so the repo under development stays clean.

```text
~/.cadre/<projectName>/
  fleet-checkpoint.json
  fleet-progress.json
  reports/
    run-report-<timestamp>.json
  worktrees/
    issue-<N>/                      # isolated git worktree for the issue
      .github/agents/
        *.agent.md
  issues/
    <N>/
      checkpoint.json
      checkpoint.backup.json
      issue.json
      repo-file-tree.txt
      analysis.md
      scout-report.md
      implementation-plan.md
      session-<id>.md
      diff-<id>.patch
      review-<id>.md
      review-<id>-summary.json
      whole-pr-diff.patch
      whole-pr-review.md
      integration-report.md
      pr-content.md
      contexts/
        <agent>-<timestamp>.json
```

The exact files present depend on how far a run has progressed, but this is the normal text-based layout for checkpoints, reports, and intermediate artifacts.

## Install The Application

### Shared prerequisites

- Node.js 20+
- Git
- A local clone of the repository you want CADRE to work on
- A GitHub token in `GITHUB_TOKEN` when `platform` is `github`, or an Azure DevOps PAT when `platform` is `azure-devops`
- An agent backend CLI on `PATH`. CADRE defaults to `copilot`. If your install exposes a different command such as `gh copilot`, set `agent.copilot.cliCommand` accordingly.
- A GitHub MCP server command when `platform` is `github`. The default is `github-mcp-server stdio`, but a Docker-backed local server also works well on every OS.

### macOS

Install the default prerequisites with Homebrew:

```bash
brew install node git github/gh-mcp/github-mcp-server
npm install -g @cadre-dev/cadre
export GITHUB_TOKEN=ghp_your_token
```

If you want to use Claude instead of the default Copilot backend:

```bash
npm install -g @anthropic-ai/claude-code
claude login
```

### Ubuntu

For a native Ubuntu install, install Node.js 20 and Git, then install CADRE:

```bash
sudo apt-get update
sudo apt-get install -y curl git
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs
npm install -g @cadre-dev/cadre
export GITHUB_TOKEN=ghp_your_token
```

If you are using GitHub, make sure `github-mcp-server` is available on your `PATH` so CADRE can use the default `github-mcp-server stdio` configuration.

If you do not want to install the GitHub MCP server binary directly, use the Docker-backed option in [GitHub MCP Server Setup](#github-mcp-server-setup).

### Windows

The recommended setup is WSL2 with Ubuntu plus Docker Desktop. CADRE's current validation path uses Unix-style `which` lookups, so WSL2 is the practical path today.

Install the host-side pieces from PowerShell:

```powershell
wsl --install -d Ubuntu
winget install Docker.DockerDesktop
```

Then open the Ubuntu shell inside WSL2 and run the Ubuntu setup commands from the previous section.

If you prefer to stay outside WSL2, Git Bash is a better fit than plain PowerShell, but WSL2 is the recommended configuration.

## GitHub MCP Server Setup

If you install the `github-mcp-server` binary directly and keep it on `PATH`, the default configuration works.

If you want a cross-platform local server without installing the binary, use Docker and add this to `cadre.config.json`:

```json
{
  "github": {
    "auth": { "token": "${GITHUB_TOKEN}" },
    "mcpServer": {
      "command": "docker",
      "args": [
        "run",
        "-i",
        "--rm",
        "-e",
        "GITHUB_PERSONAL_ACCESS_TOKEN",
        "ghcr.io/github/github-mcp-server"
      ]
    }
  }
}
```

Before running CADRE with that configuration, make sure `GITHUB_PERSONAL_ACCESS_TOKEN` is set in the shell you are using:

```bash
export GITHUB_PERSONAL_ACCESS_TOKEN="$GITHUB_TOKEN"
```

GitHub App authentication is also supported if you do not want to use a token. See `docs/config-schema.md` for the full auth options.

## Quick Start

Install globally or use `npx`:

```bash
npm install -g @cadre-dev/cadre
```

Create a `cadre.config.json` in the repository you want CADRE to work on:

```json
{
  "projectName": "my-project",
  "platform": "github",
  "repository": "owner/repo",
  "repoPath": ".",
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
    "auth": { "token": "${GITHUB_TOKEN}" },
    "mcpServer": {
      "command": "docker",
      "args": [
        "run",
        "-i",
        "--rm",
        "-e",
        "GITHUB_PERSONAL_ACCESS_TOKEN",
        "ghcr.io/github/github-mcp-server"
      ]
    }
  }
}
```

Run the pipeline:

```bash
cadre run -c cadre.config.json
cadre status -c cadre.config.json
cadre run -c cadre.config.json --resume
cadre worktrees -c cadre.config.json
```

If you do not want a global install, the same commands work with `npx @cadre-dev/cadre`.

## Using Claude Instead Of Copilot

CADRE defaults to the Copilot backend. To switch to Claude, install the Claude CLI and set `agent.backend` to `claude`.

```bash
npm install -g @anthropic-ai/claude-code
claude login
```

```json
{
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

Relevant agent fields:

| Key | Type | Default | Description |
| --- | --- | --- | --- |
| `agent.backend` | `"copilot" \| "claude"` | `"copilot"` | Which AI backend CADRE uses for agent invocations |
| `agent.model` | `string` | backend default | Model override |
| `agent.timeout` | `number` | backend default | Timeout in milliseconds |
| `agent.copilot.cliCommand` | `string` | `"copilot"` | Copilot CLI executable |
| `agent.claude.cliCommand` | `string` | `"claude"` | Claude CLI executable |

## How The Application Works

CADRE processes each issue through a five-phase pipeline:

1. Analysis and scouting
2. Planning
3. Implementation
4. Integration verification
5. Pull request composition

Each issue runs in its own git worktree. Multiple issues run in parallel up to your configured concurrency limit.

### Built-in agent roster

| Agent | Purpose |
| --- | --- |
| `issue-analyst` | Analyze issue requirements and scope |
| `codebase-scout` | Locate relevant files in the codebase |
| `implementation-planner` | Break work into dependency-aware tasks |
| `adjudicator` | Choose between competing plans |
| `code-writer` | Implement code changes |
| `test-writer` | Write tests for the change |
| `code-reviewer` | Review changes for correctness |
| `fix-surgeon` | Repair issues found by review or tests |
| `integration-checker` | Verify build and test commands pass |
| `pr-composer` | Draft the pull request title and body |

## CADRE The Framework

`@cadre-dev/framework` is the generic orchestration layer the CADRE application is built on top of. It exposes reusable packages for:

- `@cadre-dev/framework/core`: logging, events, validation, and shared runtime types
- `@cadre-dev/framework/engine`: queues, executors, retry logic, phase orchestration, and checkpointing
- `@cadre-dev/framework/runtime`: agent backends, launchers, provider registration, and runtime contracts
- `@cadre-dev/framework/flow`: a declarative flow DSL and the `FlowRunner` execution engine
- `@cadre-dev/framework/notifications`: log, webhook, and Slack-style notification plumbing

Use the framework when you want to coordinate agents or workflow steps in any domain.

## Framework Packages And Extension Points

The framework exposes reusable extension points without patching CADRE core:

- `@cadre-dev/framework/runtime`: `registerAgentBackendFactory()` for backend plugins
- `@cadre-dev/framework/runtime`: provider registration and capability discovery
- `@cadre-dev/framework/engine`: pluggable `CheckpointStore` support
- `@cadre-dev/framework/notifications`: `registerNotificationProviderFactory()` for notification plugins
- `@cadre-dev/framework/engine`: `registerGatePlugin()` for custom phase gates
- `@cadre-dev/framework/core`: `FleetEventBus.use()` middleware hooks for lifecycle interception

The application uses those primitives to build the software-development workflow. The framework lets you use the same primitives for a completely different workflow.

## A More Realistic Framework Example

The example below is intentionally not about code generation. It shows a support escalation workflow that filters for urgent incidents, gathers customer context in parallel, builds a briefing packet, and routes enterprise customers directly to an on-call response.

That is an easy-to-evaluate example because the value is obvious: less manual triage, faster response time, and better context when a human needs to step in.

```ts
import {
  FlowRunner,
  conditional,
  defineFlow,
  fromContext,
  fromStep,
  gate,
  parallel,
  step,
} from '@cadre-dev/framework/flow';

type Ticket = {
  id: string;
  customerId: string;
  plan: 'standard' | 'enterprise';
  severity: 'low' | 'medium' | 'high' | 'urgent';
  summary: string;
};

async function getCustomerProfile(customerId: string) {
  return { customerId, name: 'Acme Corp', owner: 'oncall-enterprise' };
}

async function getRecentIncidents(customerId: string) {
  return [{ id: 'INC-991', status: 'resolved' }, { id: 'INC-1040', status: 'open' }];
}

async function notifyOnCall(brief: unknown) {
  return { routedTo: 'pager', brief };
}

async function enqueueForFollowUp(brief: unknown) {
  return { routedTo: 'priority-queue', brief };
}

const flow = defineFlow<{ ticket: Ticket }>('support-escalation', [
  step({
    id: 'intake',
    input: fromContext('ticket'),
    run: (_ctx, ticket) => ticket as Ticket,
  }),
  gate({
    id: 'urgent-only',
    input: fromStep('intake'),
    evaluate: (_ctx, ticket) => {
      const current = ticket as Ticket;
      return current.severity === 'high' || current.severity === 'urgent';
    },
  }),
  parallel({
    id: 'collect-context',
    concurrency: 2,
    branches: {
      customer: [
        step({
          id: 'load-customer',
          input: fromStep('intake'),
          run: async (_ctx, ticket) => getCustomerProfile((ticket as Ticket).customerId),
        }),
      ],
      history: [
        step({
          id: 'load-history',
          input: fromStep('intake'),
          run: async (_ctx, ticket) => getRecentIncidents((ticket as Ticket).customerId),
        }),
      ],
    },
  }),
  step({
    id: 'build-brief',
    input: {
      ticket: fromStep('intake'),
      context: fromStep('collect-context'),
    },
    run: (_ctx, input) => {
      const ticket = input.ticket as Ticket;
      const context = input.context as {
        customer: { 'load-customer': unknown };
        history: { 'load-history': unknown };
      };

      return {
        ticketId: ticket.id,
        plan: ticket.plan,
        summary: ticket.summary,
        customer: context.customer['load-customer'],
        recentIncidents: context.history['load-history'],
      };
    },
  }),
  conditional({
    id: 'route-ticket',
    when: (ctx) => {
      const brief = ctx.getStepOutput('build-brief') as { plan: string };
      return brief.plan === 'enterprise';
    },
    then: [
      step({
        id: 'page-on-call',
        input: fromStep('build-brief'),
        run: async (_ctx, brief) => notifyOnCall(brief),
      }),
    ],
    else: [
      step({
        id: 'create-priority-queue-item',
        input: fromStep('build-brief'),
        run: async (_ctx, brief) => enqueueForFollowUp(brief),
      }),
    ],
  }),
]);

const runner = new FlowRunner({ concurrency: 2 });

await runner.run(flow, {
  ticket: {
    id: 'SUP-1042',
    customerId: 'cust_123',
    plan: 'enterprise',
    severity: 'urgent',
    summary: 'Checkout is timing out for all EU users',
  },
});
```

For the full DSL reference, see `docs/flow-dsl.md`.

## CLI Commands

- `cadre run`: process issues with the agent pipeline
- `cadre status`: show fleet and issue progress
- `cadre reset`: reset fleet or issue state
- `cadre worktrees`: list or manage active worktrees

## Design Principles

1. No AI logic in the runtime. The runtime manages processes, git, files, and orchestration.
2. File-based IPC. Agents communicate through files, not in-process APIs.
3. Worktree isolation. Each issue gets its own git worktree.
4. Idempotent resume. Re-running with `--resume` is safe.
5. Git operations belong to the runtime. Agents write files, while CADRE handles the git lifecycle.
6. MCP-native GitHub access. GitHub interactions go through the GitHub MCP server.

## Docs

- `docs/config-schema.md`: full configuration schema
- `docs/architecture.md`: high-level architecture and package boundaries
- `docs/flow-dsl.md`: framework flow DSL reference
- `docs/container-usage.md`: containerized usage
- `docs/security.md`: security model and isolation notes

## License

This project is licensed under the [MIT License](LICENSE).
