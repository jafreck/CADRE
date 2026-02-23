/**
 * Extracts failing test/build identifiers from command output using line-based heuristics.
 *
 * Patterns matched:
 * - Lines starting with FAIL, FAILED, ✗, or × (test runners)
 * - TypeScript compiler errors (`error TS\d+:`)
 * - Generic `error:` / `Error:` lines (under 200 chars)
 */
export function extractFailures(
  output: string,
  options?: { includeTypeScriptErrors?: boolean },
): string[] {
  const includeTS = options?.includeTypeScriptErrors ?? true;
  const failures = new Set<string>();

  for (const line of output.split('\n')) {
    const trimmed = line.trim();

    // Common test failure indicators – strip the prefix
    if (/^(FAIL|FAILED|✗|×)\s+/.test(trimmed)) {
      const match = trimmed.match(/^(?:FAIL|FAILED|✗|×)\s+(.+)/);
      if (match) failures.add(match[1].trim());
    }
    // TypeScript / build error lines (no prefix to strip)
    else if (includeTS && /error TS\d+:/.test(trimmed)) {
      failures.add(trimmed);
    }
    // Generic error lines
    else if (/^\s*(error|Error)\s*:/i.test(trimmed) && trimmed.length < 200) {
      failures.add(trimmed);
    }
  }

  return Array.from(failures);
}
