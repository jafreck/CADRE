import { z } from 'zod';

export const scoutReportSchema = z.object({
  relevantFiles: z.array(
    z.object({
      path: z.string(),
      reason: z.string(),
    })
  ),
  dependencyMap: z.record(z.string(), z.array(z.string())),
  testFiles: z.array(z.string()),
  estimatedChanges: z.array(
    z.object({
      path: z.string(),
      linesEstimate: z.number(),
    })
  ),
});

export type ScoutReport = z.infer<typeof scoutReportSchema>;
