import { z } from 'zod';

/** Input payload for the Analysis & Scouting phase (phase 1). */
export const analysisInputSchema = z.object({
  issueNumber: z.number(),
  issueTitle: z.string(),
  issueBody: z.string(),
  labels: z.array(z.string()).optional(),
});
export type AnalysisInput = z.infer<typeof analysisInputSchema>;

/** Input payload for the Planning phase (phase 2). */
export const planningInputSchema = z.object({
  issueNumber: z.number(),
  analysisPath: z.string(),
  scoutReportPath: z.string(),
});
export type PlanningInput = z.infer<typeof planningInputSchema>;

/** Input payload for the Implementation phase (phase 3). */
export const implementationInputSchema = z.object({
  issueNumber: z.number(),
  sessionId: z.string(),
  planPath: z.string(),
});
export type ImplementationInput = z.infer<typeof implementationInputSchema>;

/** Input payload for the Integration Verification phase (phase 4). */
export const integrationInputSchema = z.object({
  issueNumber: z.number(),
  worktreePath: z.string(),
  baseCommit: z.string(),
});
export type IntegrationInput = z.infer<typeof integrationInputSchema>;

/** Input payload for the PR Composition phase (phase 5). */
export const prCompositionInputSchema = z.object({
  issueNumber: z.number(),
  issueTitle: z.string(),
  issueBody: z.string(),
  analysisPath: z.string().optional(),
  planPath: z.string().optional(),
});
export type PRCompositionInput = z.infer<typeof prCompositionInputSchema>;
