import { readFile } from 'node:fs/promises';
import type { ZodType } from 'zod';
import { extractCadreJsonWithError } from '../util/cadre-json.js';
import type {
  AgentSession,
  AnalysisResult,
  ScoutReport,
  ReviewResult,
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
/**
 * Parses structured output files produced by agents.
 */
export class ResultParser {
  constructor() {}

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
   * Generic helper that reads a file, extracts the cadre-json block,
   * validates it against a Zod schema, and optionally applies a transform.
   * Throws a descriptive error with parse error details if the block is
   * missing or malformed.
   */
  private async parseArtifact<T>(
    filePath: string,
    schema: ZodType<T>,
    agentDescription: string,
    transform?: (result: T) => T,
  ): Promise<T> {
    const content = await readFile(filePath, 'utf-8');
    const { parsed, parseError } = extractCadreJsonWithError(content);
    if (parsed !== null) {
      const result = schema.parse(parsed);
      return transform ? transform(result) : result;
    }
    throw new Error(
      `Agent output in ${filePath} is missing a \`cadre-json\` block. ` +
      `The ${agentDescription} agent must emit a \`\`\`cadre-json\`\`\` fenced block.` +
      (parseError ? ` Parse error: ${parseError}` : ''),
    );
  }

  /**
   * Parse an implementation plan markdown into a list of AgentSessions.
   */
  async parseImplementationPlan(planPath: string): Promise<AgentSession[]> {
    return this.parseArtifact(planPath, implementationPlanSchema, 'implementation-planner');
  }

  /**
   * Parse a code review result from review.md.
   */
  async parseReview(reviewPath: string): Promise<ReviewResult> {
    return this.parseArtifact(reviewPath, reviewSchema, 'code-reviewer', (result) => ({
      ...result,
      summary: this.unescapeText(result.summary),
      issues: result.issues.map((issue) => ({
        ...issue,
        description: this.unescapeText(issue.description),
      })),
    }));
  }

  /**
   * Parse integration report from integration-report.md.
   */
  async parseIntegrationReport(reportPath: string): Promise<IntegrationReport> {
    return this.parseArtifact(reportPath, integrationReportSchema, 'integration-checker');
  }

  /**
   * Parse PR content from pr-content.md.
   */
  async parsePRContent(contentPath: string): Promise<PRContent> {
    return this.parseArtifact(contentPath, prContentSchema, 'PR-content', (result) => ({
      ...result,
      body: this.unescapeText(result.body),
    }));
  }

  /**
   * Parse a scout report from scout-report.md.
   */
  async parseScoutReport(reportPath: string): Promise<ScoutReport> {
    return this.parseArtifact(reportPath, scoutReportSchema, 'codebase-scout');
  }

  /**
   * Parse an analysis result from analysis.md.
   */
  async parseAnalysis(analysisPath: string): Promise<AnalysisResult> {
    return this.parseArtifact(analysisPath, analysisSchema, 'issue-analyst', (result) => ({
      ...result,
      requirements: result.requirements.map((s) => this.unescapeText(s)),
      affectedAreas: result.affectedAreas.map((s) => this.unescapeText(s)),
      ambiguities: result.ambiguities.map((s) => this.unescapeText(s)),
    }));
  }
}
