import { z } from 'zod';

export const baselineResultsSchema = z.object({
  buildExitCode: z.number(),
  testExitCode: z.number(),
  buildFailures: z.array(z.string()),
  testFailures: z.array(z.string()),
});

export type BaselineResults = z.infer<typeof baselineResultsSchema>;
