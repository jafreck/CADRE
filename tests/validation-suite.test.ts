import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockPlatformValidate = vi.hoisted(() => vi.fn());
const mockGitValidate = vi.hoisted(() => vi.fn());
const mockCommandValidate = vi.hoisted(() => vi.fn());
const mockDiskValidate = vi.hoisted(() => vi.fn());
const mockAgentBackendValidate = vi.hoisted(() => vi.fn());

vi.mock('../src/validation/platform-validator.js', () => ({
  platformValidator: { name: 'platform', validate: mockPlatformValidate },
}));
vi.mock('../src/validation/agent-backend-validator.js', () => ({
  agentBackendValidator: { name: 'agent-backend', validate: mockAgentBackendValidate },
}));
vi.mock('../src/validation/git-validator.js', () => ({
  GitValidator: vi.fn().mockImplementation(() => ({ name: 'git-validator', validate: mockGitValidate })),
}));
vi.mock('../src/validation/command-validator.js', () => ({
  CommandValidator: vi.fn().mockImplementation(() => ({ name: 'commands', validate: mockCommandValidate })),
}));
vi.mock('../src/validation/disk-validator.js', () => ({
  DiskValidator: vi.fn().mockImplementation(() => ({ name: 'disk', validate: mockDiskValidate })),
}));

import { CadreConfigSchema } from '../src/config/schema.js';
import { PreRunValidationSuite } from '../src/validation/suite.js';
import type { SuiteResult } from '../src/validation/suite.js';

const baseConfig = CadreConfigSchema.parse({
  projectName: 'test-project',
  repository: 'owner/repo',
  repoPath: '/tmp/repo',
  issues: { ids: [1] },
});

const passingResult = { passed: true, warnings: [], errors: [], name: 'validator' };
const failingResult = { passed: false, warnings: [], errors: ['Something failed'], name: 'validator' };
const warningResult = { passed: true, warnings: ['A warning'], errors: [], name: 'validator' };

function allPassing() {
  mockPlatformValidate.mockResolvedValue(passingResult);
  mockGitValidate.mockResolvedValue(passingResult);
  mockCommandValidate.mockResolvedValue(passingResult);
  mockDiskValidate.mockResolvedValue(passingResult);
  mockAgentBackendValidate.mockResolvedValue(passingResult);
}

describe('PreRunValidationSuite', () => {
  let suite: PreRunValidationSuite;

  beforeEach(() => {
    mockPlatformValidate.mockReset();
    mockGitValidate.mockReset();
    mockCommandValidate.mockReset();
    mockDiskValidate.mockReset();
    mockAgentBackendValidate.mockReset();
    suite = new PreRunValidationSuite();
  });

  describe('run()', () => {
    it('should return passed: true when all validators pass', async () => {
      allPassing();

      const result = await suite.run(baseConfig);

      expect(result.passed).toBe(true);
    });

    it('should return passed: false when any validator fails', async () => {
      allPassing();
      mockGitValidate.mockResolvedValue(failingResult);

      const result = await suite.run(baseConfig);

      expect(result.passed).toBe(false);
    });

    it('should return passed: false when the platform validator fails', async () => {
      allPassing();
      mockPlatformValidate.mockResolvedValue(failingResult);

      const result = await suite.run(baseConfig);

      expect(result.passed).toBe(false);
    });

    it('should return passed: false when the agent-backend validator fails', async () => {
      allPassing();
      mockAgentBackendValidate.mockResolvedValue(failingResult);

      const result = await suite.run(baseConfig);

      expect(result.passed).toBe(false);
    });

    it('should return warningCount of 0 when no validators emit warnings', async () => {
      allPassing();

      const result = await suite.run(baseConfig);

      expect(result.warningCount).toBe(0);
    });

    it('should aggregate warningCount across all validators', async () => {
      mockPlatformValidate.mockResolvedValue({ passed: true, warnings: ['w1', 'w2'], errors: [] });
      mockGitValidate.mockResolvedValue({ passed: true, warnings: ['w3'], errors: [] });
      mockCommandValidate.mockResolvedValue(passingResult);
      mockDiskValidate.mockResolvedValue(passingResult);
      mockAgentBackendValidate.mockResolvedValue(passingResult);

      const result = await suite.run(baseConfig);

      expect(result.warningCount).toBe(3);
    });

    it('should include a result entry for each validator', async () => {
      allPassing();

      const result = await suite.run(baseConfig);

      expect(result.results.size).toBe(5);
    });

    it('should map results by validator name', async () => {
      allPassing();
      const customResult = { passed: true, warnings: [], errors: [], name: 'platform' };
      mockPlatformValidate.mockResolvedValue(customResult);

      const result = await suite.run(baseConfig);

      expect(result.results.has('platform')).toBe(true);
      expect(result.results.get('platform')).toBe(customResult);
    });

    it('should call each validator with the provided config', async () => {
      allPassing();

      await suite.run(baseConfig);

      expect(mockPlatformValidate).toHaveBeenCalledWith(baseConfig);
      expect(mockGitValidate).toHaveBeenCalledWith(baseConfig);
      expect(mockCommandValidate).toHaveBeenCalledWith(baseConfig);
      expect(mockDiskValidate).toHaveBeenCalledWith(baseConfig);
      expect(mockAgentBackendValidate).toHaveBeenCalledWith(baseConfig);
    });

    it('should still pass when a validator passes with warnings', async () => {
      allPassing();
      mockDiskValidate.mockResolvedValue(warningResult);

      const result = await suite.run(baseConfig);

      expect(result.passed).toBe(true);
      expect(result.warningCount).toBe(1);
    });
  });

  describe('formatResults()', () => {
    it('should render ✅ for a passing validator with no warnings', () => {
      const suiteResult: SuiteResult = {
        passed: true,
        warningCount: 0,
        results: new Map([['platform', { passed: true, warnings: [], errors: [] }]]),
      };

      const output = suite.formatResults(suiteResult);

      expect(output).toContain('✅ platform');
    });

    it('should render ❌ for a failing validator', () => {
      const suiteResult: SuiteResult = {
        passed: false,
        warningCount: 0,
        results: new Map([['git-validator', { passed: false, warnings: [], errors: ['No .git dir'] }]]),
      };

      const output = suite.formatResults(suiteResult);

      expect(output).toContain('❌ git-validator');
    });

    it('should render ⚠️ for a passing validator that has warnings', () => {
      const suiteResult: SuiteResult = {
        passed: true,
        warningCount: 1,
        results: new Map([['disk', { passed: true, warnings: ['Low headroom'], errors: [] }]]),
      };

      const output = suite.formatResults(suiteResult);

      expect(output).toContain('⚠️ disk');
    });

    it('should include error messages indented under the validator line', () => {
      const suiteResult: SuiteResult = {
        passed: false,
        warningCount: 0,
        results: new Map([['commands', { passed: false, warnings: [], errors: ['npm not found'] }]]),
      };

      const output = suite.formatResults(suiteResult);

      expect(output).toContain('Error: npm not found');
    });

    it('should include warning messages indented under the validator line', () => {
      const suiteResult: SuiteResult = {
        passed: true,
        warningCount: 1,
        results: new Map([['git-validator', { passed: true, warnings: ['Dirty tree'], errors: [] }]]),
      };

      const output = suite.formatResults(suiteResult);

      expect(output).toContain('Warning: Dirty tree');
    });

    it('should render PASS summary when all validators pass', () => {
      const suiteResult: SuiteResult = {
        passed: true,
        warningCount: 0,
        results: new Map([['platform', { passed: true, warnings: [], errors: [] }]]),
      };

      const output = suite.formatResults(suiteResult);

      expect(output).toContain('PASS');
      expect(output).not.toContain('FAIL');
    });

    it('should render FAIL summary when any validator fails', () => {
      const suiteResult: SuiteResult = {
        passed: false,
        warningCount: 0,
        results: new Map([['platform', { passed: false, warnings: [], errors: ['error'] }]]),
      };

      const output = suite.formatResults(suiteResult);

      expect(output).toContain('FAIL');
    });

    it('should append warning count to PASS summary when warnings exist', () => {
      const suiteResult: SuiteResult = {
        passed: true,
        warningCount: 2,
        results: new Map([['disk', { passed: true, warnings: ['w1', 'w2'], errors: [] }]]),
      };

      const output = suite.formatResults(suiteResult);

      expect(output).toContain('PASS (2 warnings)');
    });

    it('should use singular "warning" when warningCount is 1', () => {
      const suiteResult: SuiteResult = {
        passed: true,
        warningCount: 1,
        results: new Map([['disk', { passed: true, warnings: ['w1'], errors: [] }]]),
      };

      const output = suite.formatResults(suiteResult);

      expect(output).toContain('PASS (1 warning)');
      expect(output).not.toContain('warnings)');
    });

    it('should append warning count to FAIL summary when warnings exist', () => {
      const suiteResult: SuiteResult = {
        passed: false,
        warningCount: 3,
        results: new Map([
          ['platform', { passed: false, warnings: ['w1'], errors: ['err'] }],
          ['disk', { passed: true, warnings: ['w2', 'w3'], errors: [] }],
        ]),
      };

      const output = suite.formatResults(suiteResult);

      expect(output).toContain('FAIL (3 warnings)');
    });

    it('should not include warning count in summary when warningCount is 0', () => {
      const suiteResult: SuiteResult = {
        passed: true,
        warningCount: 0,
        results: new Map([['platform', { passed: true, warnings: [], errors: [] }]]),
      };

      const output = suite.formatResults(suiteResult);

      expect(output.trim()).toBe('✅ platform\nPASS');
    });

    it('should render one line per validator', () => {
      const suiteResult: SuiteResult = {
        passed: true,
        warningCount: 0,
        results: new Map([
          ['platform', { passed: true, warnings: [], errors: [] }],
          ['git-validator', { passed: true, warnings: [], errors: [] }],
        ]),
      };

      const output = suite.formatResults(suiteResult);
      const lines = output.split('\n');

      const validatorLines = lines.filter((l) => l.startsWith('✅') || l.startsWith('❌') || l.startsWith('⚠️'));
      expect(validatorLines).toHaveLength(2);
    });
  });
});
