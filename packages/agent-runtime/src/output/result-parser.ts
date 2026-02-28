import { readFile } from 'node:fs/promises';
import type { ZodType } from 'zod';
import { extractCadreJsonWithError } from './cadre-json.js';

/**
 * Base class for parsing structured output files produced by agents.
 *
 * Provides generic cadre-json extraction, Zod validation, and text
 * unescaping.  Subclasses add agent-specific parse methods that bind
 * concrete schemas and transforms.
 */
export class BaseResultParser {
  /**
   * Normalize a markdown string that may contain JSON-style escape sequences
   * (e.g. `\\n` → actual newline, `\\t` → actual tab).
   */
  protected unescapeText(text: string): string {
    return text
      .replace(/\\n/g, '\n')
      .replace(/\\t/g, '\t')
      .replace(/\\r/g, '');
  }

  /**
   * Generic helper that reads a file, extracts the cadre-json block,
   * validates it against a Zod schema, and optionally applies a transform.
   * Throws a descriptive error with parse error details if the block is
   * missing or malformed.
   */
  protected async parseArtifact<T>(
    filePath: string,
    schema: ZodType<T>,
    agentDescription: string,
    transform?: (result: T) => T,
  ): Promise<T> {
    const content = await readFile(filePath, 'utf-8');
    const { parsed, parseError } = extractCadreJsonWithError(content);
    if (parsed !== null) {
      const result = schema.parse(parsed);
      return transform ? transform(result) : result;
    }
    throw new Error(
      `Agent output in ${filePath} is missing a \`cadre-json\` block. ` +
      `The ${agentDescription} agent must emit a \`\`\`cadre-json\`\`\` fenced block.` +
      (parseError ? ` Parse error: ${parseError}` : ''),
    );
  }
}
