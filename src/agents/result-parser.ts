import { BaseResultParser } from '@cadre/agent-runtime';
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
 * Parses structured output files produced by CADRE agents.
 * Extends the generic BaseResultParser from @cadre/agent-runtime
 * with Cadre-specific schema bindings.
 */
export class ResultParser extends BaseResultParser {
  constructor() {
    super();
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
