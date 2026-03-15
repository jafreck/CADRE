import type { ZodType } from 'zod';

/**
 * Extract and JSON-parse the first fenced block with the given marker from content.
 * Defaults to ```cadre-json``` when no marker is specified.
 * Returns the parsed value, or null if no such block exists or the JSON is invalid.
 *
 * When a Zod `schema` is provided the parsed value is validated against it and
 * the return type narrows to `T | null`.  A `ZodError` is thrown when the block
 * exists but fails validation.
 *
 * The closing fence must appear at the start of a line (preceded by a real newline).
 * This prevents false matches against ``` sequences embedded inside JSON string values
 * as escape sequences (e.g. `\n```ts` stored as two chars `\n` + backtick-backtick-backtick).
 */
export function extractCadreJson<T>(content: string, schema: ZodType<T>, marker?: string): T | null;
export function extractCadreJson(content: string, schema?: undefined, marker?: string): unknown | null;
export function extractCadreJson<T>(content: string, schema?: ZodType<T>, marker?: string): T | unknown | null {
  const { parsed } = extractCadreJsonWithError(content, marker);
  if (parsed === null) return null;
  if (schema) return schema.parse(parsed);
  return parsed;
}

/**
 * Like extractCadreJson, but also returns the underlying parse error message when
 * both the initial JSON.parse and the recovery attempt fail.
 *
 * Returns `{ parsed: value, parseError: null }` on success, or
 * `{ parsed: null, parseError: "…message…" }` on failure.
 */
export function extractCadreJsonWithError(content: string, marker = 'cadre-json'): { parsed: unknown | null; parseError: string | null } {
  const escaped = marker.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp('```' + escaped + '[ \\t]*\\n([\\s\\S]*?)\\n```[ \\t]*(\\n|$)');
  const match = content.match(re);
  if (!match) return { parsed: null, parseError: `No ${marker} block found` };
  const raw = match[1].trim();
  try {
    return { parsed: JSON.parse(raw), parseError: null };
  } catch {
    // Best-effort recovery: fix unescaped double-quotes inside JSON string values.
    try {
      return { parsed: JSON.parse(recoverUnescapedQuotes(raw)), parseError: null };
    } catch (recoveryError) {
      return { parsed: null, parseError: (recoveryError as Error).message };
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
