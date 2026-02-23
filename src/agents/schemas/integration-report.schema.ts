import { z } from 'zod';

export const commandResultSchema = z.object({
  command: z.string(),
  exitCode: z.number(),
  output: z.string(),
  pass: z.boolean(),
});

export const integrationReportSchema = z.object({
  buildResult: commandResultSchema,
  testResult: commandResultSchema,
  lintResult: commandResultSchema.optional(),
  overallPass: z.boolean(),
  baselineFailures: z.array(z.string()).optional(),
  regressionFailures: z.array(z.string()).optional(),
});

export type CommandResult = z.infer<typeof commandResultSchema>;
export type IntegrationReport = z.infer<typeof integrationReportSchema>;
