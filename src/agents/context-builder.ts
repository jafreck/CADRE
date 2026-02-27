import { join } from 'node:path';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { atomicWriteJSON, ensureDir, exists } from '../util/fs.js';
import type { CadreConfig } from '../config/schema.js';
import type {
  AgentName,
  AgentContext,
  ContextBuildArgs,
  AgentContextDescriptor,
  DescriptorHelpers,
} from './types.js';
import type { IssueDetail, ReviewThread } from '../platform/provider.js';
import { Logger } from '../logging/logger.js';
import {
  analysisSchema,
  scoutReportSchema,
  implementationPlanSchema,
  reviewSchema,
  integrationReportSchema,
  prContentSchema,
} from './schemas/index.js';

/** Registry mapping each agent to its context descriptor. */
export const AGENT_CONTEXT_REGISTRY: Record<string, AgentContextDescriptor> = {
  'issue-analyst': {
    phase: 1,
    outputFile: (args) => join(args.progressDir, 'analysis.md'),
    inputFiles: async (args) => [args.issueJsonPath!],
    outputSchema: zodToJsonSchema(analysisSchema) as Record<string, unknown>,
  },
  'codebase-scout': {
    phase: 1,
    outputFile: (args) => join(args.progressDir, 'scout-report.md'),
    inputFiles: async (args) => [args.analysisPath!, args.fileTreePath!],
    outputSchema: zodToJsonSchema(scoutReportSchema) as Record<string, unknown>,
  },
  'implementation-planner': {
    phase: 2,
    outputFile: (args) => join(args.progressDir, 'implementation-plan.md'),
    inputFiles: async (args) => [args.analysisPath!, args.scoutReportPath!],
    outputSchema: zodToJsonSchema(implementationPlanSchema) as Record<string, unknown>,
  },
  'adjudicator': {
    phase: 2,
    outputFile: (args) => join(args.progressDir, 'adjudication.md'),
    inputFiles: async (args) => [...args.planPaths!],
    payload: () => ({ decisionType: 'implementation-strategy' }),
    outputSchema: zodToJsonSchema(implementationPlanSchema) as Record<string, unknown>,
  },
  'code-writer': {
    phase: 3,
    sessionId: (args) => args.session?.id ?? args.sessionId,
    outputFile: (args) => join(args.worktreePath, '.cadre', 'tasks'),
    inputFiles: async (args, fileExists) => {
      const files = [args.sessionPlanPath!, ...(args.relevantFiles ?? [])];
      if (await fileExists(join(args.progressDir, 'analysis.md'))) {
        files.push(join(args.progressDir, 'analysis.md'));
      }
      if (await fileExists(join(args.progressDir, 'scout-report.md'))) {
        files.push(join(args.progressDir, 'scout-report.md'));
      }
      return files;
    },
    payload: (args) => {
      const payload: Record<string, unknown> = {
        sessionId: args.session!.id,
        steps: args.session!.steps,
      };
      if (args.siblingFiles && args.siblingFiles.length > 0) {
        payload.siblingFiles = args.siblingFiles;
      }
      return payload;
    },
  },
  'test-writer': {
    phase: 3,
    sessionId: (args) => args.session?.id ?? args.sessionId,
    outputFile: (args) => join(args.worktreePath, '.cadre', 'tasks'),
    inputFiles: async (args) => [...(args.changedFiles ?? []), args.sessionPlanPath!],
    payload: (args, helpers) => ({
      sessionId: args.session!.id,
      testFramework: helpers.detectTestFramework(),
    }),
  },
  'code-reviewer': {
    phase: 3,
    sessionId: (args) => args.session?.id ?? args.sessionId,
    outputFile: (args) => join(args.progressDir, `review-${args.session!.id}.md`),
    inputFiles: async (args, fileExists) => {
      const files = [args.diffPath!, args.sessionPlanPath!];
      if (await fileExists(join(args.progressDir, 'analysis.md'))) {
        files.push(join(args.progressDir, 'analysis.md'));
      }
      if (await fileExists(join(args.progressDir, 'scout-report.md'))) {
        files.push(join(args.progressDir, 'scout-report.md'));
      }
      return files;
    },
    payload: (args) => ({
      sessionId: args.session!.id,
      acceptanceCriteria: args.session!.steps.flatMap((s) => s.acceptanceCriteria),
    }),
    outputSchema: zodToJsonSchema(reviewSchema) as Record<string, unknown>,
  },
  'whole-pr-reviewer': {
    phase: 3,
    outputFile: (args) => join(args.progressDir, 'whole-pr-review.md'),
    inputFiles: async (args, fileExists) => {
      const files = [...(args.sessionPlanPaths ?? [])];
      if (await fileExists(join(args.progressDir, 'analysis.md'))) {
        files.push(join(args.progressDir, 'analysis.md'));
      }
      if (await fileExists(join(args.progressDir, 'scout-report.md'))) {
        files.push(join(args.progressDir, 'scout-report.md'));
      }
      if (await fileExists(join(args.progressDir, 'implementation-plan.md'))) {
        files.push(join(args.progressDir, 'implementation-plan.md'));
      }
      return files;
    },
    payload: (args, helpers) => ({
      scope: 'whole-pr',
      baseBranch: helpers.baseBranch,
      fullDiffPath: args.diffPath!,
      sessionSummaries: args.sessionSummaries ?? [],
    }),
    outputSchema: zodToJsonSchema(reviewSchema) as Record<string, unknown>,
  },
  'fix-surgeon': {
    phase: (args) => args.phase ?? 3,
    sessionId: (args) => args.sessionId,
    outputFile: (args) => join(args.worktreePath, '.cadre', 'tasks'),
    inputFiles: async (args, fileExists) => {
      const files = [args.feedbackPath!, ...(args.changedFiles ?? [])];
      const phase = args.phase ?? 3;
      const planFile = phase === 3
        ? join(args.progressDir, `session-${args.sessionId}.md`)
        : join(args.progressDir, 'implementation-plan.md');
      if (await fileExists(planFile)) {
        files.push(planFile);
      }
      if (await fileExists(join(args.progressDir, 'analysis.md'))) {
        files.push(join(args.progressDir, 'analysis.md'));
      }
      if (await fileExists(join(args.progressDir, 'scout-report.md'))) {
        files.push(join(args.progressDir, 'scout-report.md'));
      }
      return files;
    },
    payload: (args) => ({
      sessionId: args.sessionId!,
      issueType: args.issueType!,
    }),
  },
  'integration-checker': {
    phase: 4,
    outputFile: (args) => join(args.progressDir, 'integration-report.md'),
    inputFiles: async (args, fileExists) => {
      const files = [args.worktreePath];
      const baselinePath = join(args.worktreePath, '.cadre', 'baseline-results.json');
      if (await fileExists(baselinePath)) {
        files.push(baselinePath);
      }
      return files;
    },
    payload: (_args, helpers) => ({
      commands: {
        build: helpers.commands.build,
        test: helpers.commands.test,
        lint: helpers.commands.lint,
      },
    }),
    outputSchema: zodToJsonSchema(integrationReportSchema) as Record<string, unknown>,
  },
  'pr-composer': {
    phase: 5,
    outputFile: (args) => join(args.progressDir, 'pr-content.md'),
    inputFiles: async (args) => [args.analysisPath!, args.planPath!, args.integrationReportPath!, args.diffPath!],
    payload: (args) => ({
      issueTitle: args.issue!.title,
      issueBody: args.issue!.body,
      ...(args.previousParseError ? { previousParseError: args.previousParseError } : {}),
    }),
    outputSchema: zodToJsonSchema(prContentSchema) as Record<string, unknown>,
  },
  'conflict-resolver': {
    phase: 0,
    outputFile: (args) => join(args.progressDir, 'conflict-resolution-report.md'),
    inputFiles: async (args) => args.conflictedFiles!.map((f) => join(args.worktreePath, f)),
    payload: (args, helpers) => ({
      conflictedFiles: args.conflictedFiles!,
      baseBranch: helpers.baseBranch,
    }),
  },
  'dep-conflict-resolver': {
    phase: 0,
    outputFile: (args) => join(args.progressDir, 'dep-conflict-resolution-report.md'),
    inputFiles: async (args) => args.conflictedFiles!.map((f) => join(args.worktreePath, f)),
    payload: (args, helpers) => ({
      conflictedFiles: args.conflictedFiles!,
      conflictingBranch: args.conflictingBranch!,
      depsBranch: args.depsBranch!,
      baseBranch: helpers.baseBranch,
    }),
  },
};

/**
 * Builds per-agent context files.
 * Context files are JSON that tell each agent what inputs to read and where to write outputs.
 */
export class ContextBuilder {
  constructor(
    private readonly config: CadreConfig,
    private readonly logger: Logger,
  ) {}

  /**
   * Build a context file for any agent using the registry.
   */
  async build(agent: AgentName, args: ContextBuildArgs): Promise<string> {
    const descriptor = AGENT_CONTEXT_REGISTRY[agent];
    if (!descriptor) {
      throw new Error(`No context descriptor registered for agent: ${agent}`);
    }

    const phase = typeof descriptor.phase === 'function'
      ? descriptor.phase(args)
      : descriptor.phase;

    const sessionId = descriptor.sessionId?.(args);
    const outputPath = descriptor.outputFile(args);
    const inputFiles = await descriptor.inputFiles(args, exists);

    const helpers: DescriptorHelpers = {
      baseBranch: this.config.baseBranch,
      commands: this.config.commands,
      detectTestFramework: () => this.detectTestFramework(),
    };

    const payload = descriptor.payload
      ? await descriptor.payload(args, helpers)
      : undefined;

    const context: AgentContext = {
      agent,
      issueNumber: args.issueNumber,
      projectName: this.config.projectName,
      repository: this.config.repository,
      worktreePath: args.worktreePath,
      phase,
      ...(sessionId !== undefined ? { sessionId } : {}),
      config: { commands: this.config.commands },
      inputFiles,
      outputPath,
      ...(payload !== undefined ? { payload } : {}),
      ...(descriptor.outputSchema !== undefined ? { outputSchema: descriptor.outputSchema } : {}),
    };

    return this.writeContext(args.progressDir, agent, args.issueNumber, context);
  }

  /**
   * Build a Markdown prompt section summarising unresolved, non-outdated review threads.
   */
  buildForReviewResponse(issue: IssueDetail, reviewThreads: ReviewThread[]): string {
    const active = reviewThreads.filter((t) => !t.isResolved && !t.isOutdated);

    const lines: string[] = [
      `## Review Comments`,
      ``,
      `Issue: #${issue.number} – ${issue.title}`,
      ``,
    ];

    if (active.length === 0) {
      lines.push('_No unresolved review comments._');
    } else {
      for (const thread of active) {
        for (const comment of thread.comments) {
          lines.push(`### ${comment.path}`);
          lines.push(`**Author:** ${comment.author}`);
          lines.push(``);
          lines.push(comment.body);
          lines.push(``);
        }
      }
    }

    return lines.join('\n');
  }

  /**
   * Write a context JSON file and return the path.
   */
  private async writeContext(
    progressDir: string,
    agent: AgentName,
    issueNumber: number,
    context: AgentContext,
  ): Promise<string> {
    const contextsDir = join(progressDir, 'contexts');
    await ensureDir(contextsDir);

    const timestamp = Date.now();
    const sessionSuffix = context.sessionId ? `-${context.sessionId}` : '';
    const filename = `${agent}${sessionSuffix}-${timestamp}.json`;
    const contextPath = join(contextsDir, filename);

    await atomicWriteJSON(contextPath, context);

    this.logger.debug(`Built context for ${agent}`, {
      issueNumber,
      data: { contextPath, outputPath: context.outputPath },
    });

    return contextPath;
  }

  /**
   * Detect the test framework from the commands config.
   */
  private detectTestFramework(): string {
    const testCmd = this.config.commands.test ?? '';
    if (testCmd.includes('vitest')) return 'vitest';
    if (testCmd.includes('jest')) return 'jest';
    if (testCmd.includes('mocha')) return 'mocha';
    if (testCmd.includes('pytest')) return 'pytest';
    return 'unknown';
  }
}
