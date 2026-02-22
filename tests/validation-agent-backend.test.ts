import { describe, it, expect, vi, beforeEach } from 'vitest';
import { CadreConfigSchema } from '../src/config/schema.js';

vi.mock('../src/util/process.js', () => ({
  exec: vi.fn(),
}));

vi.mock('../src/util/fs.js', () => ({
  exists: vi.fn(),
}));

import { exec } from '../src/util/process.js';
import { exists } from '../src/util/fs.js';
import { agentBackendValidator } from '../src/validation/agent-backend-validator.js';

const baseConfig = CadreConfigSchema.parse({
  projectName: 'test-project',
  repository: 'owner/repo',
  repoPath: '/tmp/repo',
  issues: { ids: [1] },
});

describe('agentBackendValidator', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('should pass when CLI command is found and agent dir exists', async () => {
    vi.mocked(exec).mockResolvedValue({ exitCode: 0, stdout: '/usr/bin/copilot', stderr: '', signal: null, timedOut: false });
    vi.mocked(exists).mockResolvedValue(true);

    const result = await agentBackendValidator.validate(baseConfig);

    expect(result.passed).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('should fail when CLI command is not found on PATH', async () => {
    vi.mocked(exec).mockResolvedValue({ exitCode: 1, stdout: '', stderr: 'not found', signal: null, timedOut: false });
    vi.mocked(exists).mockResolvedValue(true);

    const result = await agentBackendValidator.validate(baseConfig);

    expect(result.passed).toBe(false);
    expect(result.errors).toHaveLength(1);
  });

  it('should fail when agent directory does not exist', async () => {
    vi.mocked(exec).mockResolvedValue({ exitCode: 0, stdout: '/usr/bin/copilot', stderr: '', signal: null, timedOut: false });
    vi.mocked(exists).mockResolvedValue(false);

    const result = await agentBackendValidator.validate(baseConfig);

    expect(result.passed).toBe(false);
    expect(result.errors).toHaveLength(1);
  });
});
