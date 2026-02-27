import { describe, it, expect } from 'vitest';
import * as pkg from '../../../packages/command-diagnostics/src/index.js';

describe('@cadre/command-diagnostics barrel exports', () => {
  it('should export extractFailures', () => {
    expect(typeof pkg.extractFailures).toBe('function');
  });

  it('should export computeRegressions', () => {
    expect(typeof pkg.computeRegressions).toBe('function');
  });

  it('should export verifyCommand', () => {
    expect(typeof pkg.verifyCommand).toBe('function');
  });

  it('should export captureBaseline', () => {
    expect(typeof pkg.captureBaseline).toBe('function');
  });

  it('should export baselineResultsSchema', () => {
    expect(pkg.baselineResultsSchema).toBeDefined();
    expect(typeof pkg.baselineResultsSchema.safeParse).toBe('function');
  });

  it('should export stripVSCodeEnv', () => {
    expect(typeof pkg.stripVSCodeEnv).toBe('function');
  });

  it('should export spawnProcess', () => {
    expect(typeof pkg.spawnProcess).toBe('function');
  });

  it('should export exec', () => {
    expect(typeof pkg.exec).toBe('function');
  });

  it('should export execShell', () => {
    expect(typeof pkg.execShell).toBe('function');
  });

  it('should export trackProcess', () => {
    expect(typeof pkg.trackProcess).toBe('function');
  });

  it('should export killAllTrackedProcesses', () => {
    expect(typeof pkg.killAllTrackedProcesses).toBe('function');
  });

  it('should export getTrackedProcessCount', () => {
    expect(typeof pkg.getTrackedProcessCount).toBe('function');
  });
});
