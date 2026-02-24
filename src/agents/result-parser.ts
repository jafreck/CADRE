import { readFile } from 'node:fs/promises';
import type {
  ImplementationTask,
  AnalysisResult,
  ScoutReport,
  ReviewResult,
  ReviewIssue,
  IntegrationReport,
  PRContent,
} from './types.js';
import {
  analysisSchema,
  scoutReportSchema,
  implementationPlanSchema,
  reviewSchema,
  integrationReportSchema,
  prContentSchema,
} from './schemas/index.js';
import { Logger } from '../logging/logger.js';

/**
 * Parses structured output files produced by agents.
 */
export class ResultParser {
  constructor(private readonly logger: Logger) {}

  /**
   * Extract and JSON-parse the first ```cadre-json``` fenced block in content.
   * Returns the parsed value, or null if no such block exists.
   */
  private extractCadreJson(content: string): unknown | null {
    const match = content.match(/```cadre-json\s*\n([\s\S]*?)```/);
    if (!match) return null;
    return JSON.parse(match[1].trim());
  }

  /**
   * Normalize a markdown string that may contain JSON-style escape sequences
   * (e.g. `\\n` → actual newline, `\\t` → actual tab).
   *
   * Agents that write cadre-json blocks sometimes double-escape newlines,
   * producing literal `\n` (two characters) instead of actual newline
   * characters. This results in comments/PR bodies displayed verbatim on
   * GitHub rather than rendered as Markdown.
   */
  private unescapeText(text: string): string {
    return text
      .replace(/\\n/g, '\n')
      .replace(/\\t/g, '\t')
      .replace(/\\r/g, '');
  }

  /**
   * Parse an implementation plan markdown into a list of ImplementationTasks.
   */
  async parseImplementationPlan(planPath: string): Promise<ImplementationTask[]> {
    const content = await readFile(planPath, 'utf-8');

    const parsed = this.extractCadreJson(content);
    if (parsed !== null) {
      return implementationPlanSchema.parse(parsed);
    }

    this.logger.warn(`[deprecated] parseImplementationPlan: no cadre-json block found in ${planPath}; falling back to regex parsing`);
    const tasks: ImplementationTask[] = [];

    // Split into task blocks — support both formats:
    //   ## task-001 – Name   (current template format, em-dash)
    //   ## task-001 - Name   (hyphen variant)
    //   ## Task: task-001 - Name  (legacy format)
    const taskBlocks = content.split(/^#{2,3}\s+(?:Task:\s+)?task-/im).slice(1);

    for (const block of taskBlocks) {
      try {
        const task = this.parseTaskBlock('task-' + block);
        tasks.push(task);
      } catch (err) {
        this.logger.warn(`Failed to parse task block: ${err}`);
      }
    }

    if (tasks.length === 0) {
      this.logger.warn(
        `No tasks found in implementation plan: ${planPath}. ` +
        `The implementation-planner agent must emit a \`\`\`cadre-json\`\`\` fenced block ` +
        `containing a JSON array of task objects. See the agent template for the required schema.`,
      );
    }

    return tasks;
  }

  /**
   * Parse a single task block from the implementation plan.
   */
  private parseTaskBlock(block: string): ImplementationTask {
    const lines = block.split('\n');
    const headerLine = lines[0].trim();

    // Parse "task-001 - Task Name" from the header
    // Support both em-dash (–) and hyphen (-) separators as the template uses em-dash
    const headerMatch = headerLine.match(/^(task-\d+)\s*[\-–]\s*(.+)/);
    const id = headerMatch?.[1] ?? `task-${Date.now()}`;
    const name = headerMatch?.[2]?.trim() ?? headerLine;

    // Parse description
    const descMatch = block.match(/^\*\*Description:\*\*\s*(.+?)(?=\n\*\*|\n#{2,}|$)/ms);
    const description = descMatch?.[1]?.trim() ?? '';

    // Parse files
    const filesMatch = block.match(/^\*\*Files:\*\*\s*(.+?)(?=\n\*\*|\n#{2,}|$)/ms);
    const filesStr = filesMatch?.[1]?.trim() ?? '';
    const files = filesStr
      .split(/[,\n]/)
      .map((f) => f.replace(/^[\s`-]+|[\s`]+$/g, ''))
      .filter(Boolean);

    // Parse dependencies
    const depsMatch = block.match(/^\*\*Dependencies:\*\*\s*(.+?)(?=\n\*\*|\n#{2,}|$)/ms);
    const depsStr = depsMatch?.[1]?.trim() ?? 'none';
    const dependencies = depsStr.toLowerCase() === 'none'
      ? []
      : depsStr
          .split(/[,\n]/)
          .map((d) => d.replace(/^[\s`-]+|[\s`]+$/g, ''))
          .filter(Boolean);

    // Parse complexity
    const complexityMatch = block.match(/^\*\*Complexity:\*\*\s*(simple|moderate|complex)/im);
    const complexity = (complexityMatch?.[1]?.toLowerCase() ?? 'moderate') as 'simple' | 'moderate' | 'complex';

    // Parse acceptance criteria (no `m` flag so `$` matches end-of-string, not end-of-line)
    const criteriaMatch = block.match(/\*\*Acceptance Criteria:\*\*\s*([\s\S]*?)(?=\n\*\*|\n#{2,}|$)/);
    const criteriaStr = criteriaMatch?.[1]?.trim() ?? '';
    const acceptanceCriteria = criteriaStr
      .split('\n')
      .map((l) => l.replace(/^[\s-*]+/, '').trim())
      .filter(Boolean);

    return {
      id,
      name,
      description,
      files,
      dependencies,
      complexity,
      acceptanceCriteria,
    };
  }

  /**
   * Parse a code review result from review.md.
   */
  async parseReview(reviewPath: string): Promise<ReviewResult> {
    const content = await readFile(reviewPath, 'utf-8');

    const parsed = this.extractCadreJson(content);
    if (parsed !== null) {
      const result = reviewSchema.parse(parsed);
      return {
        ...result,
        summary: this.unescapeText(result.summary),
        issues: result.issues.map((issue) => ({
          ...issue,
          description: this.unescapeText(issue.description),
        })),
      };
    }

    this.logger.warn(`[deprecated] parseReview: no cadre-json block found in ${reviewPath}; falling back to regex parsing`);

    // Find verdict
    const verdictMatch = content.match(/\*\*Verdict:\*\*\s*(pass|needs-fixes)/i)
      ?? content.match(/##\s*Verdict\s*:\s*(pass|needs-fixes)/i)
      ?? content.match(/(pass|needs-fixes)/i);

    const verdict = (verdictMatch?.[1]?.toLowerCase() ?? 'needs-fixes') as 'pass' | 'needs-fixes';

    // Parse issues
    const issues: ReviewIssue[] = [];
    const issueBlocks = content.match(/[-*]\s+\*\*(error|warning|suggestion)\*\*.*?(?=\n[-*]\s+\*\*|$)/gis) ?? [];

    for (const issueBlock of issueBlocks) {
      const severityMatch = issueBlock.match(/\*\*(error|warning|suggestion)\*\*/i);
      const severity = (severityMatch?.[1]?.toLowerCase() ?? 'warning') as ReviewIssue['severity'];
      const fileMatch = issueBlock.match(/`([^`]+\.[a-z]+)`/);
      const lineMatch = issueBlock.match(/line\s+(\d+)/i);
      const descriptionText = issueBlock
        .replace(/^[-*]\s+\*\*(error|warning|suggestion)\*\*:?\s*/i, '')
        .trim();

      issues.push({
        file: fileMatch?.[1] ?? 'unknown',
        line: lineMatch ? parseInt(lineMatch[1], 10) : undefined,
        severity,
        description: descriptionText,
      });
    }

    // Extract summary
    const summaryMatch = content.match(/##\s*Summary\s*\n([\s\S]*?)(?=\n##|$)/);
    const summary = summaryMatch?.[1]?.trim() ?? content.slice(0, 200);

    return { verdict, issues, summary };
  }

  /**
   * Parse integration report from integration-report.md.
   */
  async parseIntegrationReport(reportPath: string): Promise<IntegrationReport> {
    const content = await readFile(reportPath, 'utf-8');

    const parsed = this.extractCadreJson(content);
    if (parsed !== null) {
      return integrationReportSchema.parse(parsed);
    }

    this.logger.warn(`[deprecated] parseIntegrationReport: no cadre-json block found in ${reportPath}; falling back to regex parsing`);

    const buildResult = this.parseCommandResult(content, 'Build');
    const testResult = this.parseCommandResult(content, 'Test');
    const lintResult = this.parseCommandResult(content, 'Lint');

    const overallPass = buildResult.pass && testResult.pass && (lintResult?.pass ?? true);

    return {
      buildResult,
      testResult,
      lintResult: lintResult?.command ? lintResult : undefined,
      overallPass,
    };
  }

  /**
   * Parse a command result section from the integration report.
   */
  private parseCommandResult(content: string, commandName: string): { command: string; exitCode: number; output: string; pass: boolean } {
    const sectionMatch = content.match(
      new RegExp(`##\\s*${commandName}[\\s\\S]*?(?=\\n##|$)`, 'i'),
    );
    const section = sectionMatch?.[0] ?? '';

    const commandMatch = section.match(/\*\*Command:\*\*\s*`(.+?)`/);
    const exitCodeMatch = section.match(/\*\*Exit Code:\*\*\s*(\d+)/);
    const passMatch = section.match(/\*\*Status:\*\*\s*(pass|fail)/i);

    const exitCode = exitCodeMatch ? parseInt(exitCodeMatch[1], 10) : 1;

    return {
      command: commandMatch?.[1] ?? commandName.toLowerCase(),
      exitCode,
      output: section,
      pass: passMatch ? passMatch[1].toLowerCase() === 'pass' : exitCode === 0,
    };
  }

  /**
   * Parse PR content from pr-content.md.
   */
  async parsePRContent(contentPath: string): Promise<PRContent> {
    const content = await readFile(contentPath, 'utf-8');

    const parsed = this.extractCadreJson(content);
    if (parsed !== null) {
      const result = prContentSchema.parse(parsed);
      return { ...result, body: this.unescapeText(result.body) };
    }

    this.logger.warn(`[deprecated] parsePRContent: no cadre-json block found in ${contentPath}; falling back to regex parsing`);

    // Parse YAML frontmatter
    const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
    let title = '';
    let labels: string[] = [];

    if (frontmatterMatch) {
      const fm = frontmatterMatch[1];
      const titleMatch = fm.match(/title:\s*"(.+?)"/);
      title = titleMatch?.[1] ?? '';

      const labelsMatch = fm.match(/labels:\s*\[(.+?)\]/);
      if (labelsMatch) {
        labels = labelsMatch[1]
          .split(',')
          .map((l) => l.trim().replace(/"/g, ''))
          .filter(Boolean);
      }
    }

    // Body is everything after frontmatter
    const body = frontmatterMatch
      ? content.slice(frontmatterMatch[0].length).trim()
      : content.trim();

    return { title, body, labels };
  }

  /**
   * Parse a scout report from scout-report.md.
   */
  async parseScoutReport(reportPath: string): Promise<ScoutReport> {
    const content = await readFile(reportPath, 'utf-8');

    const parsed = this.extractCadreJson(content);
    if (parsed !== null) {
      return scoutReportSchema.parse(parsed);
    }

    this.logger.warn(`[deprecated] parseScoutReport: no cadre-json block found in ${reportPath}; falling back to regex parsing`);

    // Parse relevant files
    const filesSection = content.match(/##\s*Relevant Files\s*\n([\s\S]*?)(?=\n##|$)/i);
    const relevantFiles: ScoutReport['relevantFiles'] = [];
    if (filesSection) {
      const fileLines = filesSection[1].split('\n').filter((l) => l.match(/^\s*[-*]/));
      for (const line of fileLines) {
        const pathMatch = line.match(/`([^`]+)`/);
        const reason = line.replace(/^\s*[-*]\s*`[^`]+`\s*[-:]*\s*/, '').trim();
        if (pathMatch) {
          relevantFiles.push({ path: pathMatch[1], reason });
        }
      }
    }

    // Parse test files
    const testSection = content.match(/##\s*Test Files\s*\n([\s\S]*?)(?=\n##|$)/i);
    const testFiles: string[] = [];
    if (testSection) {
      const testLines = testSection[1].split('\n').filter((l) => l.match(/^\s*[-*]/));
      for (const line of testLines) {
        const pathMatch = line.match(/`([^`]+)`/);
        if (pathMatch) testFiles.push(pathMatch[1]);
      }
    }

    return {
      relevantFiles,
      dependencyMap: {},
      testFiles,
      estimatedChanges: relevantFiles.map((f) => ({ path: f.path, linesEstimate: 10 })),
    };
  }

  /**
   * Parse an analysis result from analysis.md.
   */
  async parseAnalysis(analysisPath: string): Promise<AnalysisResult> {
    const content = await readFile(analysisPath, 'utf-8');

    const parsed = this.extractCadreJson(content);
    if (parsed !== null) {
      const result = analysisSchema.parse(parsed);
      return {
        ...result,
        requirements: result.requirements.map((s) => this.unescapeText(s)),
        affectedAreas: result.affectedAreas.map((s) => this.unescapeText(s)),
        ambiguities: result.ambiguities.map((s) => this.unescapeText(s)),
      };
    }

    this.logger.warn(`[deprecated] parseAnalysis: no cadre-json block found in ${analysisPath}; falling back to regex parsing`);

    // Parse requirements
    const reqSection = content.match(/##\s*Requirements\s*\n([\s\S]*?)(?=\n##|$)/i);
    const requirements = this.parseBulletList(reqSection?.[1] ?? '');

    // Parse change type
    const typeMatch = content.match(/\*\*Change Type:\*\*\s*(bug.fix|feature|refactor|docs|chore)/i)
      ?? content.match(/##\s*Change Type\s*\n\s*(.+)/i);
    const changeType = this.normalizeChangeType(typeMatch?.[1] ?? 'feature');

    // Parse scope
    const scopeMatch = content.match(/\*\*Scope:\*\*\s*(small|medium|large)/i)
      ?? content.match(/##\s*Scope\s*\n\s*(.+)/i);
    const scope = (scopeMatch?.[1]?.toLowerCase() ?? 'medium') as 'small' | 'medium' | 'large';

    // Parse affected areas
    const areasSection = content.match(/##\s*Affected Areas\s*\n([\s\S]*?)(?=\n##|$)/i);
    const affectedAreas = this.parseBulletList(areasSection?.[1] ?? '');

    // Parse ambiguities
    const ambigSection = content.match(/##\s*Ambiguities\s*\n([\s\S]*?)(?=\n##|$)/i);
    const ambiguities = this.parseBulletList(ambigSection?.[1] ?? '');

    return { requirements, changeType, scope, affectedAreas, ambiguities };
  }

  private parseBulletList(text: string): string[] {
    return text
      .split('\n')
      .filter((l) => l.match(/^\s*[-*]/))
      .map((l) => l.replace(/^\s*[-*]\s*/, '').trim())
      .filter(Boolean);
  }

  private normalizeChangeType(raw: string): AnalysisResult['changeType'] {
    const lower = raw.toLowerCase().trim();
    if (lower.includes('bug')) return 'bug-fix';
    if (lower.includes('feat')) return 'feature';
    if (lower.includes('refactor')) return 'refactor';
    if (lower.includes('doc')) return 'docs';
    return 'chore';
  }
}
