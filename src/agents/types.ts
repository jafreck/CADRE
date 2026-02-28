/**
 * Agent type definitions for CADRE.
 */

import type { SessionReviewSummary } from './schemas/session-review-summary.schema.js';

// Re-export generic agent runtime types from @cadre/agent-runtime
export type {
  AgentInvocation as _AgentInvocationBase,
  AgentResult as _AgentResultBase,
  AgentStep,
  AgentSession,
  TokenUsageDetail,
  AnalysisResult,
  ScoutReport,
  ReviewResult,
  ReviewIssue,
  IntegrationReport,
  CommandResult,
  PRContent,
  GateResult,
  PhaseResult,
  AgentContext as _AgentContextBase,
} from '@cadre/agent-runtime';

import type { AgentInvocation as _AgentInvocationBase, AgentResult as _AgentResultBase, AgentContext as _AgentContextBase, AgentStep, AgentSession, TokenUsageDetail } from '@cadre/agent-runtime';

/** All known agent names. */
export type AgentName =
  | 'issue-analyst'
  | 'codebase-scout'
  | 'dependency-analyst'
  | 'dep-conflict-resolver'
  | 'implementation-planner'
  | 'adjudicator'
  | 'code-writer'
  | 'test-writer'
  | 'code-reviewer'
  | 'fix-surgeon'
  | 'integration-checker'
  | 'pr-composer'
  | 'conflict-resolver'
  | 'whole-pr-reviewer'
  | 'dogfood-triage';

/** Metadata describing a single CADRE agent. */
export interface AgentDefinition {
  name: AgentName;
  phase: number;
  phaseName: string;
  description: string;
  hasStructuredOutput: boolean;
  templateFile: string;
}

/** Registry of all 13 CADRE agents with their metadata. */
export const AGENT_DEFINITIONS: readonly AgentDefinition[] = [
  {
    name: 'issue-analyst',
    phase: 1,
    phaseName: 'Analysis & Scouting',
    description: 'Analyzes a GitHub issue to extract requirements, classify change type, estimate scope, and identify affected areas.',
    hasStructuredOutput: true,
    templateFile: 'issue-analyst.md',
  },
  {
    name: 'codebase-scout',
    phase: 1,
    phaseName: 'Analysis & Scouting',
    description: 'Scans the repository to locate relevant files, map dependencies, and identify related tests.',
    hasStructuredOutput: true,
    templateFile: 'codebase-scout.md',
  },
  {
    name: 'dependency-analyst',
    phase: 1,
    phaseName: 'Analysis & Scouting',
    description: 'Analyzes a list of issues and infers their dependency relationships, producing a DAG with no cycles.',
    hasStructuredOutput: true,
    templateFile: 'dependency-analyst.md',
  },
  {
    name: 'dep-conflict-resolver',
    phase: 0,
    phaseName: 'Orchestration',
    description: 'Resolves merge conflicts while composing DAG dependency branches before issue implementation starts.',
    hasStructuredOutput: false,
    templateFile: 'dep-conflict-resolver.md',
  },
  {
    name: 'implementation-planner',
    phase: 2,
    phaseName: 'Planning',
    description: 'Breaks a GitHub issue into discrete implementation tasks with dependencies, ordering, and acceptance criteria.',
    hasStructuredOutput: true,
    templateFile: 'implementation-planner.md',
  },
  {
    name: 'adjudicator',
    phase: 2,
    phaseName: 'Planning',
    description: 'Evaluates competing implementation plans or design decisions and selects the best option.',
    hasStructuredOutput: true,
    templateFile: 'adjudicator.md',
  },
  {
    name: 'code-writer',
    phase: 3,
    phaseName: 'Implementation',
    description: 'Implements a single task from the implementation plan by modifying or creating source files.',
    hasStructuredOutput: false,
    templateFile: 'code-writer.md',
  },
  {
    name: 'test-writer',
    phase: 3,
    phaseName: 'Implementation',
    description: 'Writes unit and integration tests for changes made by the code-writer.',
    hasStructuredOutput: false,
    templateFile: 'test-writer.md',
  },
  {
    name: 'code-reviewer',
    phase: 3,
    phaseName: 'Implementation',
    description: 'Reviews code changes for correctness, style, and potential issues with a pass/fail verdict.',
    hasStructuredOutput: true,
    templateFile: 'code-reviewer.md',
  },
  {
    name: 'fix-surgeon',
    phase: 3,
    phaseName: 'Implementation',
    description: 'Applies targeted, minimal fixes to resolve issues identified by code review or failing tests.',
    hasStructuredOutput: false,
    templateFile: 'fix-surgeon.md',
  },
  {
    name: 'integration-checker',
    phase: 4,
    phaseName: 'Integration Verification',
    description: 'Verifies all changes integrate correctly by running build, test, and lint commands.',
    hasStructuredOutput: true,
    templateFile: 'integration-checker.md',
  },
  {
    name: 'pr-composer',
    phase: 5,
    phaseName: 'PR Composition',
    description: 'Writes a clear, informative pull request title and body summarizing all changes made.',
    hasStructuredOutput: true,
    templateFile: 'pr-composer.md',
  },
  {
    name: 'conflict-resolver',
    phase: 0,
    phaseName: 'Orchestration',
    description: 'Resolves merge conflict markers in files left by a paused git rebase, producing valid compilable code.',
    hasStructuredOutput: false,
    templateFile: 'conflict-resolver.md',
  },
  {
    name: 'whole-pr-reviewer',
    phase: 3,
    phaseName: 'Implementation',
    description: 'Reviews the full PR diff against main after all implementation sessions complete, catching cross-session bugs.',
    hasStructuredOutput: true,
    templateFile: 'whole-pr-reviewer.md',
  },
  {
    name: 'dogfood-triage',
    phase: 0,
    phaseName: 'Dogfood',
    description: 'Triages collected dogfood signals into clustered topics, classifies severity, and files GitHub issues for actionable self-improvement items.',
    hasStructuredOutput: true,
    templateFile: 'dogfood-triage.md',
  },
] as const;

/** An invocation request for a CADRE agent (narrows agent to AgentName). */
export interface AgentInvocation extends Omit<_AgentInvocationBase, 'agent'> {
  agent: AgentName;
}

/** Result of a CADRE agent invocation (narrows agent to AgentName). */
export interface AgentResult extends Omit<_AgentResultBase, 'agent'> {
  agent: AgentName;
}

/** @deprecated Use AgentSession */
export type ImplementationTask = AgentSession;

/** Summary produced by a whole-pr-reviewer or session-review agent. */
export type { SessionReviewSummary } from './schemas/session-review-summary.schema.js';

/** Arguments passed to the unified build() method for context construction. */
export interface ContextBuildArgs {
  issueNumber: number;
  worktreePath: string;
  progressDir: string;
  issueBody?: string;
  issueJsonPath?: string;
  analysisPath?: string;
  fileTreePath?: string;
  scoutReportPath?: string;
  session?: AgentSession;
  sessionId?: string;
  sessionPlanPath?: string;
  relevantFiles?: string[];
  siblingFiles?: string[];
  changedFiles?: string[];
  diffPath?: string;
  planPaths?: string[];
  sessionPlanPaths?: string[];
  sessionSummaries?: SessionReviewSummary[];
  feedbackPath?: string;
  issueType?: 'review' | 'test-failure' | 'build';
  phase?: number;
  planPath?: string;
  integrationReportPath?: string;
  issue?: { title: string; body: string };
  previousParseError?: string;
  conflictedFiles?: string[];
  conflictingBranch?: string;
  depsBranch?: string;
}

/** Helpers available to descriptor functions during context building. */
export interface DescriptorHelpers {
  baseBranch: string;
  commands: { install?: string; build?: string; test?: string; lint?: string };
  detectTestFramework: () => string;
}

/** Declarative descriptor for building an agent's context. */
export interface AgentContextDescriptor {
  phase: number | ((args: ContextBuildArgs) => number);
  outputFile: (args: ContextBuildArgs) => string;
  inputFiles: (args: ContextBuildArgs, exists: (path: string) => Promise<boolean>) => Promise<string[]>;
  sessionId?: (args: ContextBuildArgs) => string | undefined;
  payload?: (args: ContextBuildArgs, helpers: DescriptorHelpers) => Record<string, unknown> | Promise<Record<string, unknown>>;
  outputSchema?: Record<string, unknown>;
}

/** Agent context file structure for CADRE agents (narrows agent to AgentName). */
export interface AgentContext extends Omit<_AgentContextBase, 'agent'> {
  agent: AgentName;
}
