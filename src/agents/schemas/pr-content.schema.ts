import { z } from 'zod';

export const prContentSchema = z.object({
  title: z.string(),
  body: z.string(),
  labels: z.array(z.string()),
});

export type PRContent = z.infer<typeof prContentSchema>;
