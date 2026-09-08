import type { ZodType } from 'zod';

/**
 * An AgentContract binds a named agent to typed input and output schemas.
 *
 * - `TInput` is the type of the payload passed to the agent.
 * - `TOutput` is the type of the structured output the agent produces.
 */
export interface AgentContract<TInput = unknown, TOutput = unknown> {
  /** Unique agent name. */
  name: string;
  /** Zod schema for validating the agent's input payload. */
  inputSchema: ZodType<TInput>;
  /** Zod schema for validating the agent's structured output. */
  outputSchema: ZodType<TOutput>;
}

/**
 * Helper to create a type-safe AgentContract.
 */
export function defineContract<TInput, TOutput>(
  name: string,
  inputSchema: ZodType<TInput>,
  outputSchema: ZodType<TOutput>,
): AgentContract<TInput, TOutput> {
  return { name, inputSchema, outputSchema };
}
