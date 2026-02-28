const CONVENTIONAL_TYPES = new Set([
  'feat',
  'fix',
  'docs',
  'refactor',
  'test',
  'chore',
  'perf',
  'build',
  'ci',
  'style',
]);

function stripIssueSuffix(text: string): string {
  return text.replace(/\s*\(#\d+\)\s*$/u, '').trim();
}

function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/gu, ' ').trim();
}

function stripConventionalPrefix(text: string): string {
  return text.replace(/^(feat|fix|docs|refactor|test|chore|perf|build|ci|style)(\([^)]+\))?:\s*/iu, '');
}

function inferType(message: string): string | null {
  const match = message.match(/^([a-z]+)(\([^)]+\))?:\s*/u);
  if (match?.[1] === undefined) return null;
  const type = match[1].toLowerCase();
  return CONVENTIONAL_TYPES.has(type) ? type : null;
}

export function formatPullRequestTitle(rawTitle: string | undefined, issueTitle: string, issueNumber: number): string {
  const candidate = normalizeWhitespace(rawTitle ?? '') || normalizeWhitespace(issueTitle) || `Issue ${issueNumber}`;
  const withoutSuffix = stripIssueSuffix(candidate);
  return `${withoutSuffix} (#${issueNumber})`;
}

export function formatCommitSubject(
  message: string,
  issueNumber: number,
  type: string | undefined,
  conventional: boolean,
): string {
  const trimmed = normalizeWhitespace(message);
  const summaryCore = stripIssueSuffix(stripConventionalPrefix(trimmed));
  const summary = summaryCore.length > 0 ? summaryCore : 'update issue changes';
  const issueTag = `(#${issueNumber})`;

  if (!conventional) {
    return `${summary} ${issueTag}`;
  }

  const normalizedType = (type ?? inferType(trimmed) ?? 'chore').toLowerCase();
  const safeType = CONVENTIONAL_TYPES.has(normalizedType) ? normalizedType : 'chore';
  const scope = `issue-${issueNumber}`;
  return `${safeType}(${scope}): ${summary} ${issueTag}`;
}
