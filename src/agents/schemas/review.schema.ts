import { z } from 'zod';

export const reviewIssueSchema = z.object({
  file: z.string(),
  line: z.number().optional(),
  severity: z.enum(['error', 'warning', 'suggestion']),
  description: z.string(),
});

export const reviewSchema = z.object({
  verdict: z.enum(['pass', 'needs-fixes']),
  issues: z.array(reviewIssueSchema),
  summary: z.string(),
});

export type ReviewIssue = z.infer<typeof reviewIssueSchema>;
export type ReviewResult = z.infer<typeof reviewSchema>;
