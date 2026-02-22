/**
 * Agent type definitions for CADRE.
 */

/** All known agent names. */
export type AgentName =
  | 'issue-analyst'
  | 'codebase-scout'
  | 'implementation-planner'
  | 'adjudicator'
  | 'code-writer'
  | 'test-writer'
  | 'code-reviewer'
  | 'fix-surgeon'
  | 'integration-checker'
  | 'pr-composer'
  | 'issue-orchestrator'
  | 'cadre-runner';

/** Metadata describing a single CADRE agent. */
export interface AgentDefinition {
  name: AgentName;
  phase: number;
  phaseName: string;
  description: string;
  hasStructuredOutput: boolean;
  templateFile: string;
}

/** Registry of all 12 CADRE agents with their metadata. */
export const AGENT_DEFINITIONS: readonly AgentDefinition[] = [
  {
    name: 'cadre-runner',
    phase: 0,
    phaseName: 'Orchestration',
    description: 'Top-level agent describing the CADRE fleet execution model and runtime behavior.',
    hasStructuredOutput: false,
    templateFile: 'cadre-runner.md',
  },
  {
    name: 'issue-orchestrator',
    phase: 0,
    phaseName: 'Orchestration',
    description: 'Reference agent describing the per-issue 5-phase development pipeline.',
    hasStructuredOutput: false,
    templateFile: 'issue-orchestrator.md',
  },
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
] as const;

/** An invocation request for an agent. */
export interface AgentInvocation {
  /** Which agent to launch. */
  agent: AgentName;
  /** The issue number this invocation is for. */
  issueNumber: number;
  /** Current pipeline phase. */
  phase: number;
  /** Optional task ID (for Implementation phase). */
  taskId?: string;
  /** Path to the context JSON file the agent should read. */
  contextPath: string;
  /** Expected output path(s). */
  outputPath: string;
  /** Timeout in ms (overrides default). */
  timeout?: number;
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
  tokenUsage: number | null;
  /** Path to the output file(s) the agent produced. */
  outputPath: string;
  /** Whether the expected output file exists. */
  outputExists: boolean;
  /** Error message if the agent failed. */
  error?: string;
}

/** An implementation task parsed from the planner's output. */
export interface ImplementationTask {
  /** Unique task ID (e.g. "task-001"). */
  id: string;
  /** Human-readable task name. */
  name: string;
  /** Description of what needs to change. */
  description: string;
  /** Source files to modify or create. */
  files: string[];
  /** IDs of tasks that must complete before this one. */
  dependencies: string[];
  /** Complexity estimate. */
  complexity: 'simple' | 'moderate' | 'complex';
  /** Acceptance criteria. */
  acceptanceCriteria: string[];
}

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
  exitCode: number;
  output: string;
  pass: boolean;
}

/** Parsed PR content output. */
export interface PRContent {
  title: string;
  body: string;
  labels: string[];
}

/** Phase result. */
export interface PhaseResult {
  phase: number;
  phaseName: string;
  success: boolean;
  duration: number;
  tokenUsage: number | null;
  outputPath?: string;
  error?: string;
}

/** Agent context file structure written before launching an agent. */
export interface AgentContext {
  agent: AgentName;
  issueNumber: number;
  projectName: string;
  repository: string;
  worktreePath: string;
  phase: number;
  taskId?: string;
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
}
