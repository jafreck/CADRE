import { z } from 'zod';

/** Analysis result output schema. */
export const analysisResultSchema = z.object({
  requirements: z.array(z.string()),
  changeType: z.enum(['bug-fix', 'feature', 'refactor', 'docs', 'chore']),
  scope: z.enum(['small', 'medium', 'large']),
  affectedAreas: z.array(z.string()),
  ambiguities: z.array(z.string()),
});

/** Scout report output schema. */
export const scoutReportSchema = z.object({
  relevantFiles: z.array(z.object({ path: z.string(), reason: z.string() })),
  dependencyMap: z.record(z.string(), z.array(z.string())),
  testFiles: z.array(z.string()),
  estimatedChanges: z.array(z.object({ path: z.string(), linesEstimate: z.number() })),
});

/** Review issue schema. */
export const reviewIssueSchema = z.object({
  file: z.string(),
  line: z.number().optional(),
  severity: z.enum(['error', 'warning', 'suggestion']),
  description: z.string(),
});

/** Code review result output schema. */
export const reviewResultSchema = z.object({
  verdict: z.enum(['pass', 'needs-fixes']),
  issues: z.array(reviewIssueSchema),
  summary: z.string(),
});

/** Command result schema. */
export const commandResultSchema = z.object({
  command: z.string(),
  exitCode: z.number().nullable(),
  signal: z.string().nullable().optional(),
  output: z.string(),
  pass: z.boolean(),
});

/** Integration report output schema. */
export const integrationReportSchema = z.object({
  buildResult: commandResultSchema,
  testResult: commandResultSchema,
  lintResult: commandResultSchema.optional(),
  overallPass: z.boolean(),
  baselineFailures: z.array(z.string()).optional(),
  regressionFailures: z.array(z.string()).optional(),
});

/** PR content output schema. */
export const prContentSchema = z.object({
  title: z.string(),
  body: z.string(),
  labels: z.array(z.string()),
});

/* ------------------------------------------------------------------ */
/*  Inferred types — keep in sync with hand-written interfaces in      */
/*  context/types.ts.  Prefer these for new code; they are the         */
/*  single-source-of-truth derived from the Zod schemas above.         */
/* ------------------------------------------------------------------ */
export type AnalysisResultOutput  = z.infer<typeof analysisResultSchema>;
export type ScoutReportOutput     = z.infer<typeof scoutReportSchema>;
export type ReviewIssueOutput     = z.infer<typeof reviewIssueSchema>;
export type ReviewResultOutput    = z.infer<typeof reviewResultSchema>;
export type CommandResultOutput   = z.infer<typeof commandResultSchema>;
export type IntegrationReportOutput = z.infer<typeof integrationReportSchema>;
export type PRContentOutput       = z.infer<typeof prContentSchema>;
