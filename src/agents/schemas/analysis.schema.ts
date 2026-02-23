import { z } from 'zod';

export const analysisSchema = z.object({
  requirements: z.array(z.string()),
  changeType: z.enum(['bug-fix', 'feature', 'refactor', 'docs', 'chore']),
  scope: z.enum(['small', 'medium', 'large']),
  affectedAreas: z.array(z.string()),
  ambiguities: z.array(z.string()),
});

export type AnalysisResult = z.infer<typeof analysisSchema>;
