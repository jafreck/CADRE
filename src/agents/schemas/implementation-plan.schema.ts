import { z } from 'zod';

export const agentStepSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  files: z.array(z.string()),
  complexity: z.enum(['simple', 'moderate', 'complex']),
  acceptanceCriteria: z.array(z.string()),
});

export const agentSessionSchema = z.object({
  id: z.string(),
  name: z.string(),
  rationale: z.string(),
  dependencies: z.array(z.string()),
  steps: z.array(agentStepSchema),
  testable: z.boolean().optional().default(true),
});

export const implementationPlanSchema = z.array(agentSessionSchema);

export type AgentStep = z.infer<typeof agentStepSchema>;
export type AgentSession = z.infer<typeof agentSessionSchema>;
export type ImplementationPlan = z.infer<typeof implementationPlanSchema>;

// Backward-compatibility aliases (deprecated — use AgentSession / AgentStep)
/** @deprecated Use AgentSession */
export type ImplementationTask = AgentSession;
/** @deprecated Use agentSessionSchema */
export const implementationTaskSchema = agentSessionSchema;
