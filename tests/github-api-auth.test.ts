import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GitHubAPI } from '../src/github/api.js';
import { Octokit } from '@octokit/rest';

vi.mock('@octokit/rest', () => ({
  Octokit: vi.fn().mockImplementation(() => ({
    rest: {
      users: {
        getAuthenticated: vi.fn(),
      },
    },
  })),
}));

function makeLogger() {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  } as any;
}

function getMockOctokit() {
  return vi.mocked(Octokit).mock.results[vi.mocked(Octokit).mock.results.length - 1].value as {
    rest: {
      users: { getAuthenticated: ReturnType<typeof vi.fn> };
    };
  };
}

describe('GitHubAPI.checkAuth()', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns true when octokit.rest.users.getAuthenticated() resolves successfully', async () => {
    const api = new GitHubAPI('owner/repo', makeLogger());
    getMockOctokit().rest.users.getAuthenticated.mockResolvedValueOnce({ data: { login: 'octocat' } });

    const result = await api.checkAuth();

    expect(result).toBe(true);
  });

  it('returns false when octokit.rest.users.getAuthenticated() rejects', async () => {
    const api = new GitHubAPI('owner/repo', makeLogger());
    getMockOctokit().rest.users.getAuthenticated.mockRejectedValueOnce(new Error('401 Unauthorized'));

    const result = await api.checkAuth();

    expect(result).toBe(false);
  });
});
