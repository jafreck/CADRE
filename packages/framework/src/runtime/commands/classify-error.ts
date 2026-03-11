/**
 * Classifies stderr/stdout output from build/test commands into
 * infrastructure vs code-quality failures.
 */

export type ErrorClass = 'infra' | 'code-quality' | 'unknown';

const INFRA_PATTERNS: RegExp[] = [
  // File-lock / resource contention
  /lock file|\.lock.*already|ELOCK|locked by another/i,
  // Out of memory
  /out of memory|OOM|ENOMEM|heap out of memory|JavaScript heap/i,
  // Network
  /ECONNREFUSED|ECONNRESET|ETIMEDOUT|ENOTFOUND|fetch failed|network error|socket hang up/i,
  // Timeout
  /timed?\s*out|SIGALRM|deadline exceeded/i,
  // Permission / access
  /EACCES|EPERM|permission denied|access denied/i,
  // Disk space
  /ENOSPC|no space left|disk full/i,
  // DNS
  /getaddrinfo|EAI_AGAIN|name resolution/i,
  // Docker / container
  /container.*exited|docker.*error|cannot connect to.*daemon/i,
  // Git
  /unable to access.*repository|fatal:.*Could not read from remote/i,
];

/**
 * Classify an error string (typically stderr from a build/test command)
 * into an infrastructure failure, a code-quality failure, or unknown.
 *
 * Infrastructure failures are transient and retryable.
 * Code-quality failures require code changes to resolve.
 */
export function classifyError(stderr: string): ErrorClass {
  if (!stderr || stderr.trim().length === 0) return 'unknown';

  for (const pattern of INFRA_PATTERNS) {
    if (pattern.test(stderr)) return 'infra';
  }

  // If there's actual content but no infra pattern matched,
  // assume it's a code-quality issue (test failures, lint errors, type errors, etc.)
  if (stderr.trim().length > 0) return 'code-quality';

  return 'unknown';
}
