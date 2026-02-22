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
