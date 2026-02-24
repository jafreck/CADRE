import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@inquirer/prompts', () => ({
  input: vi.fn(),
  select: vi.fn(),
  confirm: vi.fn(),
}));

vi.mock('../src/util/fs.js', () => ({
  exists: vi.fn().mockResolvedValue(true),
}));

import { input, select, confirm } from '@inquirer/prompts';
import {
  collectAnswers,
  validateAzureDevOpsRepository,
} from '../src/cli/prompts.js';

const mockInput = vi.mocked(input);
const mockSelect = vi.mocked(select);
const mockConfirm = vi.mocked(confirm);

// ─── helpers ─────────────────────────────────────────────────────────────────

/** Set up mocks for the yes=true fast path. */
function setupYesTrue(platform: 'github' | 'azure-devops' = 'github') {
  mockInput
    .mockResolvedValueOnce('my-project') // projectName
    .mockResolvedValueOnce('owner/repo'); // repository
  mockSelect.mockResolvedValueOnce(platform); // platform
}

/**
 * Set up mocks for the yes=false, GitHub, ids mode, token auth, no-commands path.
 * Returns the token that was configured.
 */
function setupNoYesGitHubIdsToken(token = 'ghp_secret') {
  mockInput
    .mockResolvedValueOnce('my-project') // projectName
    .mockResolvedValueOnce('owner/repo') // repository
    .mockResolvedValueOnce('/tmp/repo') // repoPath
    .mockResolvedValueOnce('main') // baseBranch
    .mockResolvedValueOnce(token); // token (in promptGitHubAuth)
  mockSelect
    .mockResolvedValueOnce('github') // platform
    .mockResolvedValueOnce('ids') // issueMode
    .mockResolvedValueOnce('token'); // auth method
  mockConfirm.mockResolvedValueOnce(false); // wantsCommands
}

describe('collectAnswers – yes=true fast path', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns issueMode { mode: "query", state: "open", limit: 10 }', async () => {
    setupYesTrue();
    const result = await collectAnswers(true);
    expect(result.issueMode).toEqual({ mode: 'query', state: 'open', limit: 10 });
  });

  it('sets baseBranch to "main"', async () => {
    setupYesTrue();
    const result = await collectAnswers(true);
    expect(result.baseBranch).toBe('main');
  });

  it('sets repoPath to repoPathOverride when provided', async () => {
    setupYesTrue();
    const result = await collectAnswers(true, '/custom/path');
    expect(result.repoPath).toBe('/custom/path');
  });

  it('sets repoPath to process.cwd() when no override', async () => {
    setupYesTrue();
    const result = await collectAnswers(true);
    expect(result.repoPath).toBe(process.cwd());
  });

  it('calls input only for projectName and repository', async () => {
    setupYesTrue();
    await collectAnswers(true);
    expect(mockInput).toHaveBeenCalledTimes(2);
  });

  it('calls select only for platform', async () => {
    setupYesTrue();
    await collectAnswers(true);
    expect(mockSelect).toHaveBeenCalledTimes(1);
  });

  it('returns githubAuth: undefined', async () => {
    setupYesTrue();
    const result = await collectAnswers(true);
    expect(result.githubAuth).toBeUndefined();
  });

  it('returns commands as empty object', async () => {
    setupYesTrue();
    const result = await collectAnswers(true);
    expect(result.commands).toEqual({});
  });

  it('returns the projectName from input', async () => {
    setupYesTrue();
    const result = await collectAnswers(true);
    expect(result.projectName).toBe('my-project');
  });
});

describe('collectAnswers – yes=false, GitHub platform, token auth', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns { method: "token", token } when token auth selected', async () => {
    setupNoYesGitHubIdsToken('ghp_mytoken');
    const result = await collectAnswers(false);
    expect(result.githubAuth).toEqual({ method: 'token', token: 'ghp_mytoken' });
  });

  it('returns issueMode { mode: "ids" } when ids selected', async () => {
    setupNoYesGitHubIdsToken();
    const result = await collectAnswers(false);
    expect(result.issueMode).toEqual({ mode: 'ids' });
  });

  it('returns issueMode { mode: "query", state, limit: 10 } when query selected', async () => {
    vi.clearAllMocks();
    mockInput
      .mockResolvedValueOnce('my-project') // projectName
      .mockResolvedValueOnce('owner/repo') // repository
      .mockResolvedValueOnce('/tmp/repo') // repoPath
      .mockResolvedValueOnce('main') // baseBranch
      .mockResolvedValueOnce('ghp_token'); // token
    mockSelect
      .mockResolvedValueOnce('github') // platform
      .mockResolvedValueOnce('query') // issueMode
      .mockResolvedValueOnce('open') // state
      .mockResolvedValueOnce('token'); // auth method
    mockConfirm.mockResolvedValueOnce(false);

    const result = await collectAnswers(false);
    expect(result.issueMode).toEqual({ mode: 'query', state: 'open', limit: 10 });
  });

  it('returns { method: "app", appId, installationId, privateKeyFile } when app auth selected', async () => {
    vi.clearAllMocks();
    mockInput
      .mockResolvedValueOnce('my-project') // projectName
      .mockResolvedValueOnce('owner/repo') // repository
      .mockResolvedValueOnce('/tmp/repo') // repoPath
      .mockResolvedValueOnce('main') // baseBranch
      .mockResolvedValueOnce('12345') // appId
      .mockResolvedValueOnce('67890') // installationId
      .mockResolvedValueOnce('/path/key.pem'); // privateKeyFile
    mockSelect
      .mockResolvedValueOnce('github') // platform
      .mockResolvedValueOnce('ids') // issueMode
      .mockResolvedValueOnce('app'); // auth method
    mockConfirm.mockResolvedValueOnce(false);

    const result = await collectAnswers(false);
    expect(result.githubAuth).toEqual({
      method: 'app',
      appId: '12345',
      installationId: '67890',
      privateKeyFile: '/path/key.pem',
    });
  });

  it('returns commands {} when user declines (confirm → false)', async () => {
    setupNoYesGitHubIdsToken();
    const result = await collectAnswers(false);
    expect(result.commands).toEqual({});
  });

  it('returns commands object with fields when user confirms', async () => {
    vi.clearAllMocks();
    mockInput
      .mockResolvedValueOnce('my-project') // projectName
      .mockResolvedValueOnce('owner/repo') // repository
      .mockResolvedValueOnce('/tmp/repo') // repoPath
      .mockResolvedValueOnce('main') // baseBranch
      .mockResolvedValueOnce('ghp_token') // token (auth)
      .mockResolvedValueOnce('npm install') // install
      .mockResolvedValueOnce('npm run build') // build
      .mockResolvedValueOnce('npm test') // test
      .mockResolvedValueOnce('npm run lint'); // lint
    mockSelect
      .mockResolvedValueOnce('github') // platform
      .mockResolvedValueOnce('ids') // issueMode
      .mockResolvedValueOnce('token'); // auth method
    mockConfirm.mockResolvedValueOnce(true); // wantsCommands

    const result = await collectAnswers(false);
    expect(result.commands).toMatchObject({
      install: 'npm install',
      build: 'npm run build',
      test: 'npm test',
      lint: 'npm run lint',
    });
  });
});

describe('collectAnswers – yes=false, azure-devops platform', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('does NOT call GitHub auth prompts', async () => {
    mockInput
      .mockResolvedValueOnce('my-project') // projectName
      .mockResolvedValueOnce('my-repo') // repository
      .mockResolvedValueOnce('/tmp/repo') // repoPath
      .mockResolvedValueOnce('main'); // baseBranch
    mockSelect
      .mockResolvedValueOnce('azure-devops') // platform
      .mockResolvedValueOnce('ids'); // issueMode
    mockConfirm.mockResolvedValueOnce(false);

    const result = await collectAnswers(false);
    expect(result.githubAuth).toBeUndefined();
  });

  it('returns platform azure-devops in the result', async () => {
    mockInput
      .mockResolvedValueOnce('my-project') // projectName
      .mockResolvedValueOnce('my-repo') // repository
      .mockResolvedValueOnce('/tmp/repo') // repoPath
      .mockResolvedValueOnce('main'); // baseBranch
    mockSelect
      .mockResolvedValueOnce('azure-devops') // platform
      .mockResolvedValueOnce('ids'); // issueMode
    mockConfirm.mockResolvedValueOnce(false);

    const result = await collectAnswers(false);
    expect(result.platform).toBe('azure-devops');
  });

  it('uses validateAzureDevOpsRepository as the validate function for the repository input', async () => {
    mockInput
      .mockResolvedValueOnce('my-project') // projectName
      .mockResolvedValueOnce('my-repo') // repository
      .mockResolvedValueOnce('/tmp/repo') // repoPath
      .mockResolvedValueOnce('main'); // baseBranch
    mockSelect
      .mockResolvedValueOnce('azure-devops') // platform
      .mockResolvedValueOnce('ids'); // issueMode
    mockConfirm.mockResolvedValueOnce(false);

    await collectAnswers(false);

    // The repository input is the 2nd call to input
    const repositoryCall = mockInput.mock.calls[1][0] as { validate?: unknown };
    expect(repositoryCall.validate).toBe(validateAzureDevOpsRepository);
  });
});
