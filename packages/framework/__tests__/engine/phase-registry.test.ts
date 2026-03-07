import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import {
  PhaseRegistry,
  buildRegistry,
  buildGateMap,
  getPhase,
  getPhaseCount,
  getPhaseSubset,
  isLastPhase,
} from '../../src/engine/phase/registry.js';
import {
  registerGatePlugin,
  clearGatePlugins,
  listGatePlugins,
} from '../../src/engine/gate/phase-gate.js';
import type { PhaseManifestEntry } from '../../src/engine/phase/registry.js';
import type { PhaseContext, PhaseExecutor } from '../../src/engine/executor/phase-executor.js';
import type { GateResult } from '../../src/engine/types.js';

function makeExecutor(id: number, name: string): PhaseExecutor<PhaseContext> {
  return { id, name, execute: async () => `output-${id}` };
}

function makeManifestEntry(
  id: number,
  name: string,
  gate: { validate: () => Promise<GateResult> } | null = null,
): PhaseManifestEntry<PhaseContext> {
  return {
    id,
    name,
    executorFactory: () => makeExecutor(id, name),
    gate,
    critical: true,
    includeInReviewResponse: false,
  };
}

const phases = [
  { id: 1, name: 'Analysis', critical: true },
  { id: 2, name: 'Planning', critical: true },
  { id: 3, name: 'Implementation', critical: true },
  { id: 4, name: 'Integration', critical: false },
  { id: 5, name: 'PR Composition', critical: false },
];

describe('phase registry utilities', () => {
  describe('getPhase', () => {
    it('returns phase by id', () => {
      expect(getPhase(phases, 3)).toEqual({ id: 3, name: 'Implementation', critical: true });
    });

    it('returns undefined for non-existent id', () => {
      expect(getPhase(phases, 99)).toBeUndefined();
    });
  });

  describe('getPhaseCount', () => {
    it('returns the number of phases', () => {
      expect(getPhaseCount(phases)).toBe(5);
    });
  });

  describe('getPhaseSubset', () => {
    it('filters phases by id', () => {
      const subset = getPhaseSubset(phases, [1, 3, 5]);
      expect(subset.map((p) => p.id)).toEqual([1, 3, 5]);
    });

    it('returns empty for no matches', () => {
      expect(getPhaseSubset(phases, [99])).toEqual([]);
    });
  });

  describe('isLastPhase', () => {
    it('returns true for the last phase', () => {
      expect(isLastPhase(phases, 5)).toBe(true);
    });

    it('returns false for non-last phases', () => {
      expect(isLastPhase(phases, 3)).toBe(false);
    });
  });
});

describe('PhaseRegistry', () => {
  it('registers and retrieves executors in order', () => {
    const registry = new PhaseRegistry();
    const ex1 = makeExecutor(1, 'A');
    const ex2 = makeExecutor(2, 'B');
    registry.register(ex1);
    registry.register(ex2);
    expect(registry.getAll()).toEqual([ex1, ex2]);
  });
});

describe('buildRegistry', () => {
  it('builds a registry from a manifest', () => {
    const manifest = [
      makeManifestEntry(1, 'Phase 1'),
      makeManifestEntry(2, 'Phase 2'),
    ];
    const registry = buildRegistry(manifest);
    const executors = registry.getAll();
    expect(executors).toHaveLength(2);
    expect(executors[0].id).toBe(1);
    expect(executors[1].id).toBe(2);
  });
});

describe('buildGateMap', () => {
  beforeEach(() => clearGatePlugins());
  afterEach(() => clearGatePlugins());

  it('creates gate map from manifest entries', () => {
    const gate1 = { validate: async () => ({ status: 'pass' as const, errors: [], warnings: [] }) };
    const manifest = [
      makeManifestEntry(1, 'Phase 1', gate1),
      makeManifestEntry(2, 'Phase 2'),
    ];
    const map = buildGateMap(manifest, []);
    expect(map[1]).toBeDefined();
    expect(map[2]).toBeUndefined();
  });

  it('incorporates gate plugins', () => {
    const pluginGate = { validate: async () => ({ status: 'pass' as const, errors: [], warnings: [] }) };
    registerGatePlugin({ name: 'test-plugin', id: 3, gate: pluginGate });

    const manifest = [makeManifestEntry(1, 'Phase 1')];
    const map = buildGateMap(manifest);
    expect(map[3]).toBeDefined();
  });

  it('composes multiple gates for the same phase', async () => {
    const gate1 = { validate: async () => ({ status: 'pass' as const, errors: [], warnings: ['from gate1'] }) };
    const gate2 = { validate: async () => ({ status: 'warn' as const, errors: [], warnings: ['from gate2'] }) };

    registerGatePlugin({ name: 'plugin1', id: 1, gate: gate2, priority: 10 });

    const manifest = [makeManifestEntry(1, 'Phase 1', gate1)];
    const map = buildGateMap(manifest);

    // The composed gate should merge results
    const result = await map[1].validate({ artifactsDir: '', workspacePath: '' });
    expect(result.warnings).toContain('from gate1');
    expect(result.warnings).toContain('from gate2');
    expect(result.status).toBe('warn');
  });

  it('composed gate returns fail if any sub-gate fails', async () => {
    const passGate = { validate: async () => ({ status: 'pass' as const, errors: [], warnings: [] }) };
    const failGate = { validate: async () => ({ status: 'fail' as const, errors: ['validation failed'], warnings: [] }) };

    registerGatePlugin({ name: 'fail-plugin', id: 1, gate: failGate });

    const manifest = [makeManifestEntry(1, 'Phase 1', passGate)];
    const map = buildGateMap(manifest);

    const result = await map[1].validate({ artifactsDir: '', workspacePath: '' });
    expect(result.status).toBe('fail');
    expect(result.errors).toContain('validation failed');
  });
});

describe('gate plugin ordering', () => {
  beforeEach(() => clearGatePlugins());
  afterEach(() => clearGatePlugins());

  it('sorts plugins by priority descending', () => {
    registerGatePlugin({ name: 'low', id: 1, gate: { validate: async () => ({ status: 'pass' as const, errors: [], warnings: [] }) }, priority: 1 });
    registerGatePlugin({ name: 'high', id: 1, gate: { validate: async () => ({ status: 'pass' as const, errors: [], warnings: [] }) }, priority: 10 });
    registerGatePlugin({ name: 'mid', id: 1, gate: { validate: async () => ({ status: 'pass' as const, errors: [], warnings: [] }) }, priority: 5 });

    const plugins = listGatePlugins();
    expect(plugins.map((p) => p.name)).toEqual(['high', 'mid', 'low']);
  });
});
