import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as pipelineEngine from '@cadre/pipeline-engine';
import { PhaseRegistry as CorePhaseRegistry, buildRegistry as buildCoreRegistry } from '../../../src/core/phase-registry.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

describe('@cadre/pipeline-engine barrel exports', () => {
  it('should export PhaseRegistry', () => {
    expect(typeof pipelineEngine.PhaseRegistry).toBe('function');
  });

  it('should export CheckpointManager and FleetCheckpointManager', () => {
    expect(typeof pipelineEngine.CheckpointManager).toBe('function');
    expect(typeof pipelineEngine.FleetCheckpointManager).toBe('function');
  });

  it('should export WorkItemDag and IssueDag', () => {
    expect(typeof pipelineEngine.WorkItemDag).toBe('function');
    expect(typeof pipelineEngine.IssueDag).toBe('function');
  });

  it('should export helper functions for phase manifests', () => {
    expect(typeof pipelineEngine.getPhaseSubset).toBe('function');
    expect(typeof pipelineEngine.getPhase).toBe('function');
    expect(typeof pipelineEngine.getPhaseCount).toBe('function');
    expect(typeof pipelineEngine.isLastPhase).toBe('function');
    expect(typeof pipelineEngine.buildRegistry).toBe('function');
    expect(typeof pipelineEngine.buildGateMap).toBe('function');
  });
});

describe('pipeline-engine runtime integration path', () => {
  it('core PhaseRegistry re-export should match package export identity', () => {
    expect(CorePhaseRegistry).toBe(pipelineEngine.PhaseRegistry);
  });

  it('core buildRegistry should construct package PhaseRegistry instances', () => {
    const registry = buildCoreRegistry();
    expect(registry).toBeInstanceOf(pipelineEngine.PhaseRegistry);
  });

  it('core wrappers should avoid packages/pipeline-engine/src path leaks', () => {
    const coreFiles = [
      '../../../src/core/phase-executor.ts',
      '../../../src/core/phase-gate.ts',
      '../../../src/core/phase-registry.ts',
      '../../../src/core/issue-dag.ts',
      '../../../src/core/checkpoint.ts',
      '../../../src/core/progress.ts',
    ];

    for (const relativePath of coreFiles) {
      const content = readFileSync(resolve(__dirname, relativePath), 'utf8');
      expect(content).not.toContain('packages/pipeline-engine/src/');
    }
  });
});