import { describe, it, expect } from 'vitest';
import type { TokenUsageDetail, AgentResult, PhaseResult } from '../src/agents/types.js';
import type { TokenRecord } from '../src/budget/token-tracker.js';

describe('TokenUsageDetail', () => {
  it('should accept a valid TokenUsageDetail with all required fields', () => {
    const detail: TokenUsageDetail = {
      input: 1500,
      output: 500,
      model: 'claude-3-5-sonnet',
    };
    expect(detail.input).toBe(1500);
    expect(detail.output).toBe(500);
    expect(detail.model).toBe('claude-3-5-sonnet');
  });

  it('should accept zero values for input and output', () => {
    const detail: TokenUsageDetail = {
      input: 0,
      output: 0,
      model: 'gpt-4o',
    };
    expect(detail.input).toBe(0);
    expect(detail.output).toBe(0);
  });

  it('should accept any string as model', () => {
    const detail: TokenUsageDetail = {
      input: 100,
      output: 50,
      model: 'some-custom-model-v1',
    };
    expect(detail.model).toBe('some-custom-model-v1');
  });
});

describe('AgentResult.tokenUsage', () => {
  const baseAgentResult = {
    agent: 'code-writer' as const,
    success: true,
    exitCode: 0,
    timedOut: false,
    duration: 5000,
    stdout: '',
    stderr: '',
    outputPath: '/output/file.md',
    outputExists: true,
  };

  it('should accept tokenUsage as null', () => {
    const result: AgentResult = { ...baseAgentResult, tokenUsage: null };
    expect(result.tokenUsage).toBeNull();
  });

  it('should accept tokenUsage as a number', () => {
    const result: AgentResult = { ...baseAgentResult, tokenUsage: 2000 };
    expect(result.tokenUsage).toBe(2000);
  });

  it('should accept tokenUsage as a TokenUsageDetail', () => {
    const detail: TokenUsageDetail = { input: 1200, output: 800, model: 'claude-sonnet' };
    const result: AgentResult = { ...baseAgentResult, tokenUsage: detail };
    expect(result.tokenUsage).toEqual(detail);
  });

  it('should preserve TokenUsageDetail fields when accessed via tokenUsage', () => {
    const detail: TokenUsageDetail = { input: 300, output: 100, model: 'gpt-4' };
    const result: AgentResult = { ...baseAgentResult, tokenUsage: detail };
    const usage = result.tokenUsage as TokenUsageDetail;
    expect(usage.input).toBe(300);
    expect(usage.output).toBe(100);
    expect(usage.model).toBe('gpt-4');
  });
});

describe('PhaseResult.tokenUsage', () => {
  const basePhaseResult = {
    phase: 1,
    phaseName: 'Analysis',
    success: true,
    duration: 10000,
  };

  it('should accept tokenUsage as null', () => {
    const result: PhaseResult = { ...basePhaseResult, tokenUsage: null };
    expect(result.tokenUsage).toBeNull();
  });

  it('should accept tokenUsage as a number', () => {
    const result: PhaseResult = { ...basePhaseResult, tokenUsage: 500 };
    expect(result.tokenUsage).toBe(500);
  });

  it('should accept tokenUsage as a TokenUsageDetail', () => {
    const detail: TokenUsageDetail = { input: 400, output: 100, model: 'claude-haiku' };
    const result: PhaseResult = { ...basePhaseResult, tokenUsage: detail };
    expect(result.tokenUsage).toEqual(detail);
  });
});

describe('TokenRecord optional input/output fields', () => {
  it('should accept a TokenRecord without input or output fields', () => {
    const record: TokenRecord = {
      issueNumber: 1,
      agent: 'issue-analyst',
      phase: 1,
      tokens: 1000,
      timestamp: '2024-01-01T00:00:00.000Z',
    };
    expect(record.input).toBeUndefined();
    expect(record.output).toBeUndefined();
    expect(record.tokens).toBe(1000);
  });

  it('should accept a TokenRecord with optional input and output fields', () => {
    const record: TokenRecord = {
      issueNumber: 2,
      agent: 'code-writer',
      phase: 3,
      tokens: 2000,
      timestamp: '2024-06-01T12:00:00.000Z',
      input: 1500,
      output: 500,
    };
    expect(record.input).toBe(1500);
    expect(record.output).toBe(500);
    expect(record.input! + record.output!).toBe(record.tokens);
  });

  it('should accept a TokenRecord with only input field set', () => {
    const record: TokenRecord = {
      issueNumber: 3,
      agent: 'test-writer',
      phase: 3,
      tokens: 800,
      timestamp: '2024-06-01T12:00:00.000Z',
      input: 800,
    };
    expect(record.input).toBe(800);
    expect(record.output).toBeUndefined();
  });

  it('should accept a TokenRecord with only output field set', () => {
    const record: TokenRecord = {
      issueNumber: 4,
      agent: 'pr-composer',
      phase: 5,
      tokens: 200,
      timestamp: '2024-06-01T12:00:00.000Z',
      output: 200,
    };
    expect(record.input).toBeUndefined();
    expect(record.output).toBe(200);
  });

  it('should accept zero values for input and output', () => {
    const record: TokenRecord = {
      issueNumber: 5,
      agent: 'integration-checker',
      phase: 4,
      tokens: 0,
      timestamp: '2024-06-01T12:00:00.000Z',
      input: 0,
      output: 0,
    };
    expect(record.input).toBe(0);
    expect(record.output).toBe(0);
  });
});
