/**
 * Agent type definitions for CADRE.
 */

import type { SessionReviewSummary } from './schemas/session-review-summary.schema.js';

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
  | 'whole-pr-reviewer';

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
] as const;

/** An invocation request for an agent. */
export interface AgentInvocation {
  /** Which agent to launch. */
  agent: AgentName;
  /** The issue number this invocation is for. */
  issueNumber: number;
  /** Current pipeline phase. */
  phase: number;
  /** Optional session ID (for Implementation phase). */
  sessionId?: string;
  /** Path to the context JSON file the agent should read. */
  contextPath: string;
  /** Expected output path(s). */
  outputPath: string;
  /** Timeout in ms (overrides default). */
  timeout?: number;
}

/** Detailed token usage split by input/output tokens and model. */
export interface TokenUsageDetail {
  input: number;
  output: number;
  model: string;
}

/** Result of an agent invocation. */
export interface AgentResult {
  /** Which agent was invoked. */
  agent: AgentName;
  /** Whether the agent completed successfully. */
  success: boolean;
  /** Process exit code. */
  exitCode: number | null;
  /** Whether the agent was killed due to timeout. */
  timedOut: boolean;
  /** Duration in ms. */
  duration: number;
  /** Full stdout from the agent process. */
  stdout: string;
  /** Full stderr from the agent process. */
  stderr: string;
  /** Token usage (parsed from output if available), or null if not reported. */
  tokenUsage: TokenUsageDetail | number | null;
  /** Path to the output file(s) the agent produced. */
  outputPath: string;
  /** Whether the expected output file exists. */
  outputExists: boolean;
  /** Error message if the agent failed. */
  error?: string;
}

/** A discrete unit of work within an agent session. */
export interface AgentStep {
  /** Unique step ID (e.g. "session-001-step-001"). */
  id: string;
  /** Human-readable step name. */
  name: string;
  /** Description of what this step changes and why. */
  description: string;
  /** Source files to modify or create. */
  files: string[];
  /** Complexity estimate for this step. */
  complexity: 'simple' | 'moderate' | 'complex';
  /** Testable acceptance criteria. */
  acceptanceCriteria: string[];
}

/** A single code-writer agent invocation, containing an ordered list of steps. */
export interface AgentSession {
  /** Unique session ID (e.g. "session-001"). */
  id: string;
  /** Short human-readable label. */
  name: string;
  /** Why these steps are grouped together. */
  rationale: string;
  /** Session IDs that must complete before this session starts. */
  dependencies: string[];
  /** Ordered steps to execute within this session. */
  steps: AgentStep[];
  /** Whether to launch a test-writer for this session. Defaults to true. Set to false for sessions that produce no directly testable logic (e.g., config-only, lockfile, type-definition-only). */
  testable?: boolean;
}

/** @deprecated Use AgentSession */
export type ImplementationTask = AgentSession;

/** Parsed analysis output. */
export interface AnalysisResult {
  requirements: string[];
  changeType: 'bug-fix' | 'feature' | 'refactor' | 'docs' | 'chore';
  scope: 'small' | 'medium' | 'large';
  affectedAreas: string[];
  ambiguities: string[];
}

/** Parsed scout report output. */
export interface ScoutReport {
  relevantFiles: Array<{ path: string; reason: string }>;
  dependencyMap: Record<string, string[]>;
  testFiles: string[];
  estimatedChanges: Array<{ path: string; linesEstimate: number }>;
}

/** Summary produced by a whole-pr-reviewer or session-review agent. */
export type { SessionReviewSummary } from './schemas/session-review-summary.schema.js';

/** Parsed code review output. */
export interface ReviewResult {
  verdict: 'pass' | 'needs-fixes';
  issues: ReviewIssue[];
  summary: string;
}

export interface ReviewIssue {
  file: string;
  line?: number;
  severity: 'error' | 'warning' | 'suggestion';
  description: string;
}

/** Parsed integration report. */
export interface IntegrationReport {
  buildResult: CommandResult;
  testResult: CommandResult;
  lintResult?: CommandResult;
  overallPass: boolean;
}

export interface CommandResult {
  command: string;
  exitCode: number | null;
  signal?: string | null;
  output: string;
  pass: boolean;
}

/** Parsed PR content output. */
export interface PRContent {
  title: string;
  body: string;
  labels: string[];
}

/** Result of a quality gate evaluation. */
export interface GateResult {
  status: 'pass' | 'warn' | 'fail';
  warnings: string[];
  errors: string[];
}

/** Phase result. */
export interface PhaseResult {
  phase: number;
  phaseName: string;
  success: boolean;
  duration: number;
  tokenUsage: TokenUsageDetail | number | null;
  outputPath?: string;
  error?: string;
  gateResult?: GateResult;
}

/** Arguments passed to the unified build() method for context construction. */
export interface ContextBuildArgs {
  issueNumber: number;
  worktreePath: string;
  progressDir: string;
  dependencyIssues?: Array<Record<string, unknown>>;
  dependencyHint?: string;
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

/** Agent context file structure written before launching an agent. */
export interface AgentContext {
  agent: AgentName;
  issueNumber: number;
  projectName: string;
  repository: string;
  worktreePath: string;
  phase: number;
  sessionId?: string;
  config: {
    commands: {
      install?: string;
      build?: string;
      test?: string;
      lint?: string;
    };
  };
  inputFiles: string[];
  outputPath: string;
  payload?: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
}
