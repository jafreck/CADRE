/**
 * Generic agent runtime types.
 *
 * These types are framework-agnostic — they use `string` for the agent field
 * so downstream consumers can narrow to their own agent name union.
 */

/** An invocation request for an agent. */
export interface AgentInvocation {
  /** Which agent to launch. */
  agent: string;
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
  agent: string;
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

/** Comment on an issue or work item. */
export interface IssueComment {
  author: string;
  body: string;
  createdAt: string;
}

/** Normalized representation of an issue or work item across platforms. */
export interface IssueDetail {
  number: number;
  title: string;
  body: string;
  labels: string[];
  assignees: string[];
  milestone?: string;
  comments: IssueComment[];
  state: 'open' | 'closed';
  createdAt: string;
  updatedAt: string;
  linkedPRs: number[];
}

/** Agent context file structure written before launching an agent.
 *
 *  `TPayload` defaults to `Record<string, unknown>` for backward compatibility.
 *  Narrow it to a phase-specific input type (e.g. `AgentContext<AnalysisInput>`)
 *  for compile-time safety on `payload`. */
export interface AgentContext<TPayload = Record<string, unknown>> {
  agent: string;
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
  /** Typed payload — per-phase structured input passed to the agent.
   *  When `TPayload` is narrowed, this field is fully typed at compile time. */
  payload?: TPayload;
  outputSchema?: Record<string, unknown>;
}
