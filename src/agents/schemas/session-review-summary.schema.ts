import { z } from 'zod';

export const sessionReviewSummarySchema = z.object({
  sessionId: z.string(),
  verdict: z.enum(['pass', 'needs-fixes']),
  summary: z.string(),
  keyFindings: z.array(z.string()),
});

export type SessionReviewSummary = z.infer<typeof sessionReviewSummarySchema>;
