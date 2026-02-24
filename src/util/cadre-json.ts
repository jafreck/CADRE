/**
 * Extract and JSON-parse the first ```cadre-json``` fenced block from content.
 * Returns the parsed value, or null if no such block exists or the JSON is invalid.
 */
export function extractCadreJson(content: string): unknown | null {
  const match = content.match(/```cadre-json\s*\n([\s\S]*?)```/);
  if (!match) return null;
  try {
    return JSON.parse(match[1].trim());
  } catch {
    return null;
  }
}
