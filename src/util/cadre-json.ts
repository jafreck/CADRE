/**
 * Extract and JSON-parse the first ```cadre-json``` fenced block from content.
 * Returns the parsed value, or null if no such block exists or the JSON is invalid.
 *
 * The closing fence must appear at the start of a line (preceded by a real newline).
 * This prevents false matches against ``` sequences embedded inside JSON string values
 * as escape sequences (e.g. `\n```ts` stored as two chars `\n` + backtick-backtick-backtick).
 */
export function extractCadreJson(content: string): unknown | null {
  const match = content.match(/```cadre-json[ \t]*\n([\s\S]*?)\n```[ \t]*(\n|$)/);
  if (!match) return null;
  try {
    return JSON.parse(match[1].trim());
  } catch {
    return null;
  }
}
