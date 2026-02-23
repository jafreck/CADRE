import { z } from 'zod';

export const implementationTaskSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  files: z.array(z.string()),
  dependencies: z.array(z.string()),
  complexity: z.enum(['simple', 'moderate', 'complex']),
  acceptanceCriteria: z.array(z.string()),
});

export const implementationPlanSchema = z.array(implementationTaskSchema);

export type ImplementationTask = z.infer<typeof implementationTaskSchema>;
export type ImplementationPlan = z.infer<typeof implementationPlanSchema>;
