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
  const raw = match[1].trim();
  try {
    return JSON.parse(raw);
  } catch {
    // Best-effort recovery: fix unescaped double-quotes inside JSON string values.
    try {
      return JSON.parse(recoverUnescapedQuotes(raw));
    } catch {
      return null;
    }
  }
}

/**
 * Walk through `raw` character-by-character and escape any `"` that appear
 * inside a JSON string value but are not already escaped.
 *
 * Heuristic: a `"` ends the current string only when the next non-whitespace
 * character is a valid JSON structural character (`,`, `}`, `]`, `:`) or
 * end-of-input. Otherwise the `"` is treated as an unescaped inner quote and
 * replaced with `\"`.
 */
function recoverUnescapedQuotes(raw: string): string {
  let result = '';
  let inString = false;
  let i = 0;
  while (i < raw.length) {
    const ch = raw[i];
    if (!inString) {
      result += ch;
      if (ch === '"') inString = true;
    } else {
      if (ch === '\\') {
        // Consume the escape sequence as-is.
        result += ch;
        i++;
        if (i < raw.length) result += raw[i];
      } else if (ch === '"') {
        // Peek past whitespace to determine if this is the closing quote.
        let j = i + 1;
        while (j < raw.length && /[ \t\r\n]/.test(raw[j])) j++;
        const next = j < raw.length ? raw[j] : '';
        if (next === '' || /[,}\]:]/.test(next)) {
          // Closing quote — end the string.
          result += ch;
          inString = false;
        } else {
          // Unescaped quote inside the string — escape it.
          result += '\\"';
        }
      } else {
        result += ch;
      }
    }
    i++;
  }
  return result;
}
