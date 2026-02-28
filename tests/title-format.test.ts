import { describe, it, expect } from 'vitest';
import { formatPullRequestTitle, formatCommitSubject } from '../src/util/title-format.js';

describe('title-format', () => {
  describe('formatPullRequestTitle', () => {
    it('appends canonical issue suffix once', () => {
      expect(formatPullRequestTitle('Add timeout handling', 'Issue title', 42)).toBe('Add timeout handling (#42)');
    });

    it('de-duplicates existing issue suffix from composer output', () => {
      expect(formatPullRequestTitle('Add timeout handling (#42)', 'Issue title', 42)).toBe('Add timeout handling (#42)');
    });

    it('falls back to issue title when title is blank', () => {
      expect(formatPullRequestTitle('   ', 'Fix race condition', 7)).toBe('Fix race condition (#7)');
    });
  });

  describe('formatCommitSubject', () => {
    it('formats conventional commit subject with canonical scope and issue suffix', () => {
      expect(formatCommitSubject('implement queue runner', 19, 'feat', true))
        .toBe('feat(issue-19): implement queue runner (#19)');
    });

    it('normalizes existing conventional prefix and issue suffix', () => {
      expect(formatCommitSubject('fix(parser): handle edge case (#19)', 19, undefined, true))
        .toBe('fix(issue-19): handle edge case (#19)');
    });

    it('formats non-conventional commit subject with issue suffix only', () => {
      expect(formatCommitSubject('sync generated files', 3, undefined, false))
        .toBe('sync generated files (#3)');
    });
  });
});
