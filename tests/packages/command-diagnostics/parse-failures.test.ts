import { describe, it, expect } from 'vitest';
import { extractFailures } from '../../../packages/command-diagnostics/src/parse-failures.js';

describe('extractFailures', () => {
  it('should return empty array for empty output', () => {
    expect(extractFailures('')).toEqual([]);
  });

  it('should return empty array for output with no failures', () => {
    expect(extractFailures('All tests passed\nDone in 1.2s')).toEqual([]);
  });

  it('should extract FAIL-prefixed lines', () => {
    const output = 'FAIL src/foo.test.ts\nsome other line\nFAIL src/bar.test.ts';
    expect(extractFailures(output)).toEqual(['src/foo.test.ts', 'src/bar.test.ts']);
  });

  it('should extract FAILED-prefixed lines', () => {
    const output = 'FAILED src/baz.test.ts';
    expect(extractFailures(output)).toEqual(['src/baz.test.ts']);
  });

  it('should extract ✗-prefixed lines', () => {
    const output = '✗ should do something';
    expect(extractFailures(output)).toEqual(['should do something']);
  });

  it('should extract ×-prefixed lines', () => {
    const output = '× another failing test';
    expect(extractFailures(output)).toEqual(['another failing test']);
  });

  it('should extract TypeScript compiler errors by default', () => {
    const output = "src/foo.ts(3,5): error TS2345: Argument of type 'string' is not assignable";
    expect(extractFailures(output)).toEqual([output.trim()]);
  });

  it('should skip TypeScript errors when includeTypeScriptErrors is false', () => {
    const output = "src/foo.ts(3,5): error TS2345: Argument of type 'string' is not assignable";
    expect(extractFailures(output, { includeTypeScriptErrors: false })).toEqual([]);
  });

  it('should extract generic error: lines under 200 chars', () => {
    const output = 'error: Cannot find module foo';
    expect(extractFailures(output)).toEqual(['error: Cannot find module foo']);
  });

  it('should extract Error: lines under 200 chars', () => {
    const output = 'Error: Something went wrong';
    expect(extractFailures(output)).toEqual(['Error: Something went wrong']);
  });

  it('should ignore error lines over 200 chars', () => {
    const longLine = 'error: ' + 'x'.repeat(200);
    expect(extractFailures(longLine)).toEqual([]);
  });

  it('should deduplicate identical failure lines', () => {
    const output = 'FAIL src/foo.ts\nFAIL src/foo.ts';
    expect(extractFailures(output)).toEqual(['src/foo.ts']);
  });

  it('should handle mixed failure types in one output', () => {
    const output = [
      'FAIL src/foo.test.ts',
      '✗ should work',
      "src/bar.ts(1,1): error TS1005: ';' expected.",
      'error: Module not found',
      'some normal line',
    ].join('\n');
    const result = extractFailures(output);
    expect(result).toContain('src/foo.test.ts');
    expect(result).toContain('should work');
    expect(result).toContain("src/bar.ts(1,1): error TS1005: ';' expected.");
    expect(result).toContain('error: Module not found');
    expect(result).toHaveLength(4);
  });

  it('should trim whitespace from extracted lines', () => {
    const output = '  FAIL   src/foo.test.ts  ';
    expect(extractFailures(output)).toEqual(['src/foo.test.ts']);
  });
});
