import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the fs exists utility used by validateRepoPath
vi.mock('../src/util/fs.js', () => ({
  exists: vi.fn(),
}));

import { exists } from '../src/util/fs.js';
import {
  validateProjectName,
  validateRepoPath,
  validateGitHubRepository,
  validateAzureDevOpsRepository,
  validateNonEmpty,
} from '../src/cli/prompts.js';

const mockExists = vi.mocked(exists);

describe('validateProjectName', () => {
  it('should accept lowercase letters', () => {
    expect(validateProjectName('myproject')).toBe(true);
  });

  it('should accept digits', () => {
    expect(validateProjectName('project123')).toBe(true);
  });

  it('should accept hyphens', () => {
    expect(validateProjectName('my-project')).toBe(true);
  });

  it('should accept a mix of lowercase letters, digits, and hyphens', () => {
    expect(validateProjectName('my-project-42')).toBe(true);
  });

  it('should reject uppercase letters', () => {
    expect(validateProjectName('MyProject')).not.toBe(true);
  });

  it('should reject spaces', () => {
    expect(validateProjectName('my project')).not.toBe(true);
  });

  it('should reject special characters', () => {
    expect(validateProjectName('my_project!')).not.toBe(true);
  });

  it('should reject empty string', () => {
    expect(validateProjectName('')).not.toBe(true);
  });

  it('should return an error message string on failure', () => {
    const result = validateProjectName('Bad Name');
    expect(typeof result).toBe('string');
    expect(result).toContain('lowercase');
  });
});

describe('validateRepoPath', () => {
  beforeEach(() => {
    mockExists.mockReset();
  });

  it('should return true when .git directory exists', async () => {
    mockExists.mockResolvedValue(true);
    const result = await validateRepoPath('/some/repo');
    expect(result).toBe(true);
    expect(mockExists).toHaveBeenCalledWith('/some/repo/.git');
  });

  it('should return an error message when .git directory is missing', async () => {
    mockExists.mockResolvedValue(false);
    const result = await validateRepoPath('/not/a/repo');
    expect(typeof result).toBe('string');
    expect(result).toContain('.git');
    expect(result).toContain('/not/a/repo');
  });

  it('should join the path with .git correctly', async () => {
    mockExists.mockResolvedValue(true);
    await validateRepoPath('/tmp/my-project');
    expect(mockExists).toHaveBeenCalledWith('/tmp/my-project/.git');
  });
});

describe('validateGitHubRepository', () => {
  it('should accept owner/repo format', () => {
    expect(validateGitHubRepository('owner/repo')).toBe(true);
  });

  it('should accept hyphenated owner and repo names', () => {
    expect(validateGitHubRepository('my-org/my-repo')).toBe(true);
  });

  it('should reject plain repo name without slash', () => {
    expect(validateGitHubRepository('myrepo')).not.toBe(true);
  });

  it('should reject two slashes', () => {
    expect(validateGitHubRepository('owner/repo/extra')).not.toBe(true);
  });

  it('should reject empty string', () => {
    expect(validateGitHubRepository('')).not.toBe(true);
  });

  it('should reject leading slash', () => {
    expect(validateGitHubRepository('/repo')).not.toBe(true);
  });

  it('should reject trailing slash', () => {
    expect(validateGitHubRepository('owner/')).not.toBe(true);
  });

  it('should return an error message string on failure', () => {
    const result = validateGitHubRepository('badformat');
    expect(typeof result).toBe('string');
    expect(result).toContain('owner/repo');
  });
});

describe('validateAzureDevOpsRepository', () => {
  it('should accept a plain repo name', () => {
    expect(validateAzureDevOpsRepository('myrepo')).toBe(true);
  });

  it('should accept project/repo format', () => {
    expect(validateAzureDevOpsRepository('my-project/my-repo')).toBe(true);
  });

  it('should reject empty string', () => {
    expect(validateAzureDevOpsRepository('')).not.toBe(true);
  });

  it('should reject whitespace-only string', () => {
    expect(validateAzureDevOpsRepository('   ')).not.toBe(true);
  });

  it('should return an error message string on failure', () => {
    const result = validateAzureDevOpsRepository('');
    expect(typeof result).toBe('string');
  });
});

describe('validateNonEmpty', () => {
  it('should accept a non-empty string', () => {
    expect(validateNonEmpty('main')).toBe(true);
  });

  it('should accept a string with leading/trailing spaces', () => {
    // trim is applied internally, so " main " has non-empty trimmed content
    expect(validateNonEmpty(' main ')).toBe(true);
  });

  it('should reject an empty string', () => {
    expect(validateNonEmpty('')).not.toBe(true);
  });

  it('should reject a whitespace-only string', () => {
    expect(validateNonEmpty('   ')).not.toBe(true);
  });

  it('should return an error message string on failure', () => {
    const result = validateNonEmpty('');
    expect(typeof result).toBe('string');
  });
});
