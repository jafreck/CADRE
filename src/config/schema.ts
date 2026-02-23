import { z } from 'zod';

const NotificationsProviderSchema = z.object({
  /** Provider type. */
  type: z.enum(['webhook', 'slack', 'log']),
  /** Webhook URL (webhook/slack providers). Supports ${ENV_VAR} syntax. */
  url: z.string().optional(),
  /** Webhook URL alias (webhook provider). Supports ${ENV_VAR} syntax. */
  webhookUrl: z.string().optional(),
  /** Slack channel (slack provider). */
  channel: z.string().optional(),
  /** Log file path (log provider). */
  logFile: z.string().optional(),
  /** Event types to include. Omit to receive all events. */
  events: z.array(z.string()).optional(),
});

const NotificationsConfigSchema = z
  .object({
    /** Enable notifications. */
    enabled: z.boolean().default(false),
    /** Notification providers. */
    providers: z.array(NotificationsProviderSchema).default([]),
  })
  .default({ enabled: false, providers: [] });

export type NotificationsConfig = z.infer<typeof NotificationsConfigSchema>;

export const AgentConfigSchema = z.object({
  /** Which AI backend to use for agent invocations. */
  backend: z.enum(['copilot', 'claude']).default('copilot'),
  /** Model identifier to pass to the backend (overrides backend-specific default). */
  model: z.string().optional(),
  /** Timeout in milliseconds for agent invocations. */
  timeout: z.number().int().optional(),
  /** Copilot-backend-specific options. */
  copilot: z
    .object({
      cliCommand: z.string().default('copilot'),
      agentDir: z.string().default('.github/agents'),
      costOverrides: z
        .record(
          z.string(),
          z.object({
            input: z.number().min(0),
            output: z.number().min(0),
          }),
        )
        .optional(),
    })
    .default({}),
  /** Claude-backend-specific options. */
  claude: z
    .object({
      cliCommand: z.string().default('claude'),
    })
    .default({}),
});

export const CadreConfigSchema = z.object({
  /** Human-readable project name, used for directory naming. */
  projectName: z.string().min(1).regex(/^[a-z0-9-]+$/),

  /**
   * Platform to use for issue tracking and PRs.
   * Defaults to "github" for backward compatibility.
   */
  platform: z.enum(['github', 'azure-devops']).default('github'),

  /**
   * Repository identifier.
   * For GitHub: "owner/repo" format.
   * For Azure DevOps: the repository name (or "project/repo").
   */
  repository: z.string().min(1),

  /** Path to the local clone of the repository (the main worktree). */
  repoPath: z.string(),

  /** Base branch that worktrees are created from (e.g. "main", "develop"). */
  baseBranch: z.string().default('main'),

  /** Where to create worktree directories. Defaults to `.cadre/worktrees/`. */
  worktreeRoot: z.string().optional(),

  /** Issue selection — either explicit IDs or a query. */
  issues: z.union([
    z.object({
      ids: z.array(z.number().int().positive()),
    }),
    z.object({
      query: z.object({
        labels: z.array(z.string()).optional(),
        milestone: z.string().optional(),
        assignee: z.string().optional(),
        state: z.enum(['open', 'closed', 'all']).default('open'),
        limit: z.number().int().min(1).max(100).default(10),
      }),
    }),
  ]),

  /** Branch naming template. Supports {issue} and {title} placeholders. */
  branchTemplate: z.string().default('cadre/issue-{issue}'),

  /** Commit message conventions. */
  commits: z
    .object({
      /** Use conventional commits (feat:, fix:, etc.). */
      conventional: z.boolean().default(true),
      /** Sign commits with GPG. */
      sign: z.boolean().default(false),
      /** Commit after each completed phase. */
      commitPerPhase: z.boolean().default(true),
      /** Squash all phase commits into one before PR. */
      squashBeforePR: z.boolean().default(false),
    })
    .default({}),

  /** Pull request configuration. */
  pullRequest: z
    .object({
      /** Auto-create PR when issue pipeline completes. */
      autoCreate: z.boolean().default(true),
      /** Draft PR instead of ready-for-review. */
      draft: z.boolean().default(true),
      /** Add labels to the PR. */
      labels: z.array(z.string()).default(['cadre-generated']),
      /** Request review from these users. */
      reviewers: z.array(z.string()).default([]),
      /** Link PR to the issue (closes #N). */
      linkIssue: z.boolean().default(true),
    })
    .default({}),

  options: z
    .object({
      /** Max issues processed in parallel (each in its own worktree). */
      maxParallelIssues: z.number().int().min(1).max(20).default(3),
      /** Max agents running in parallel within a single issue pipeline. */
      maxParallelAgents: z.number().int().min(1).max(10).default(3),
      /** Max retries per task before marking blocked. */
      maxRetriesPerTask: z.number().int().min(1).max(5).default(3),
      /** Total token budget across all issues (optional cap). */
      tokenBudget: z.number().int().optional(),
      /** Per-issue token budget (optional cap). */
      perIssueTokenBudget: z.number().int().optional(),
      /** Dry run — analyze and plan only, no code changes. */
      dryRun: z.boolean().default(false),
      /** Resume from last checkpoint. */
      resume: z.boolean().default(false),
      /** Delay between agent invocations in ms (rate limiting). */
      invocationDelayMs: z.number().int().min(0).default(0),
      /** Run build command after implementation to verify compilation. */
      buildVerification: z.boolean().default(true),
      /** Run test command after implementation to verify tests pass. */
      testVerification: z.boolean().default(true),
      /** Skip pre-run validation checks. */
      skipValidation: z.boolean().default(false),
    })
    .default({}),

  /** Build and test commands to run inside the worktree. */
  commands: z
    .object({
      /** Install dependencies command (runs once per worktree). */
      install: z.string().optional(),
      /** Build/compile command. */
      build: z.string().optional(),
      /** Test command. */
      test: z.string().optional(),
      /** Lint command. */
      lint: z.string().optional(),
    })
    .default({}),

  copilot: z
    .object({
      cliCommand: z.string().default('copilot'),
      model: z.string().default('claude-sonnet-4.6'),
      agentDir: z.string().default('.github/agents'),
      timeout: z.number().int().default(300_000),
      costOverrides: z
        .record(
          z.string(),
          z.object({
            input: z.number().min(0),
            output: z.number().min(0),
          }),
        )
        .optional(),
    })
    .default({}),

  environment: z
    .object({
      inheritShellPath: z.boolean().default(true),
      shell: z.string().optional(),
      extraPath: z.array(z.string()).default([]),
    })
    .default({}),

  /**
   * GitHub MCP server and authentication configuration.
   * Required when platform is "github".
   *
   * If omitted entirely, CADRE will look for GITHUB_TOKEN in the environment
   * and use the default `github-mcp-server stdio` command.
   */
  github: z
    .object({
      /** MCP server spawn configuration. */
      mcpServer: z
        .object({
          /** Command to launch the GitHub MCP server. */
          command: z.string(),
          /** Arguments for the server command. */
          args: z.array(z.string()).default([]),
        })
        .default({
          command: 'github-mcp-server',
          args: ['stdio'],
        }),

      /**
       * Authentication method. Two options:
       *
       * 1. **Token** (simplest — works with `gh auth token`, Copilot CLI, Claude CLI):
       *    `{ "token": "${GITHUB_TOKEN}" }`
       *
       * 2. **GitHub App** (for CI / org-level access):
       *    `{ "appId": "...", "installationId": "...", "privateKeyFile": "..." }`
       *
       * If omitted, CADRE auto-detects from GITHUB_TOKEN env var.
       * Supports ${ENV_VAR} syntax in all values.
       */
      auth: z
        .union([
          // Token-based auth (PAT or gh auth token)
          z.object({
            /** Personal access token or `gh auth token` output. */
            token: z.string().min(1),
          }),
          // GitHub App auth (existing)
          z.object({
            /** GitHub App ID. */
            appId: z.string().min(1),
            /** GitHub App installation ID for the target repository/org. */
            installationId: z.string().min(1),
            /**
             * Path to the PEM-encoded private key file.
             * Supports ${ENV_VAR} syntax to reference host environment variables.
             */
            privateKeyFile: z.string().min(1),
          }),
        ])
        .optional(),
    })
    .optional(),

  /** Controls which lifecycle events post comments to the issue. */
  issueUpdates: z
    .object({
      /** Master switch — disable all issue comments at once. */
      enabled: z.boolean().default(true),
      /** Post a comment when an issue pipeline starts. */
      onStart: z.boolean().default(true),
      /** Post a comment when each phase completes. */
      onPhaseComplete: z.boolean().default(false),
      /** Post a comment when the pipeline completes successfully. */
      onComplete: z.boolean().default(true),
      /** Post a comment when the pipeline fails. */
      onFailed: z.boolean().default(true),
      /** Post a comment when approaching the token budget limit. */
      onBudgetWarning: z.boolean().default(true),
    })
    .default({}),

  /**
   * Azure DevOps configuration.
   * Required when platform is "azure-devops".
   */
  azureDevOps: z
    .object({
      /** Azure DevOps organization name. */
      organization: z.string().min(1),
      /** Azure DevOps project name. */
      project: z.string().min(1),
      /** Repository name within the project (defaults to project name). */
      repositoryName: z.string().optional(),
      /** Authentication credentials. */
      auth: z.object({
        /**
         * Personal Access Token.
         * Supports ${ENV_VAR} syntax to reference host environment variables.
         */
        pat: z.string().min(1),
      }),
    })
    .optional(),

  /** Cleanup configuration for pruning merged/closed PR worktrees and branches. */
  cleanup: z
    .object({
      /** Remove the remote branch after cleanup. */
      deleteRemoteBranch: z.boolean().default(true),
      /** Clean up when the associated PR is merged. */
      onMerged: z.boolean().default(true),
      /** Clean up when the associated PR is closed without merging. */
      onClosed: z.boolean().default(false),
    })
    .optional(),

  /** Notification provider configuration. Optional; defaults to disabled. */
  notifications: NotificationsConfigSchema,

  /** Agent backend configuration. Optional; uses copilot defaults when omitted. */
  agent: AgentConfigSchema.optional(),
});

export type CadreConfig = z.infer<typeof CadreConfigSchema>;
export type CleanupConfig = NonNullable<CadreConfig['cleanup']>;
