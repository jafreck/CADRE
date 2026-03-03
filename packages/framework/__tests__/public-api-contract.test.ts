import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const testDir = dirname(fileURLToPath(import.meta.url));
const packageDir = resolve(testDir, '..');
const packageJsonPath = resolve(packageDir, 'package.json');
const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as {
  main?: string;
  types?: string;
  exports?: Record<string, { types?: string; default?: string }>;
  typesVersions?: Record<string, Record<string, string[]>>;
};

const expectedExports: Record<string, { types: string; default: string }> = {
  '.': {
    types: './dist/index.d.ts',
    default: './dist/index.js',
  },
  './core': {
    types: './dist/core/index.d.ts',
    default: './dist/core/index.js',
  },
  './runtime': {
    types: './dist/runtime/index.d.ts',
    default: './dist/runtime/index.js',
  },
  './engine': {
    types: './dist/engine/index.d.ts',
    default: './dist/engine/index.js',
  },
  './flow': {
    types: './dist/flow/index.d.ts',
    default: './dist/flow/index.js',
  },
  './notifications': {
    types: './dist/notifications/index.d.ts',
    default: './dist/notifications/index.js',
  },
};

const expectedTypesVersions = {
  '*': {
    core: ['dist/core/index.d.ts'],
    runtime: ['dist/runtime/index.d.ts'],
    engine: ['dist/engine/index.d.ts'],
    flow: ['dist/flow/index.d.ts'],
    notifications: ['dist/notifications/index.d.ts'],
  },
};

describe('framework package contract', () => {
  it('uses dist artifacts in package metadata and explicit subpath exports', () => {
    expect(packageJson.main).toBe('./dist/index.js');
    expect(packageJson.types).toBe('./dist/index.d.ts');
    expect(packageJson.exports).toEqual(expectedExports);
    expect(packageJson.typesVersions).toEqual(expectedTypesVersions);
  });

  it('keeps all export targets scoped to dist artifacts', () => {
    const filesToCheck = [
      packageJson.main,
      packageJson.types,
      ...Object.values(expectedExports).flatMap((entry) => [entry.default, entry.types]),
    ].filter((value): value is string => Boolean(value));

    for (const relativePath of filesToCheck) {
      expect(relativePath.startsWith('./dist/')).toBe(true);
      if (relativePath.endsWith('.d.ts')) {
        expect(relativePath).toMatch(/^\.\/dist\/.+\.d\.ts$/);
      } else {
        expect(relativePath).toMatch(/^\.\/dist\/.+\.js$/);
      }
    }
  });

  it('keeps runtime export surface stable across barrel modules', async () => {
    const rootApi = await import('../src/index.ts');
    const coreApi = await import('../src/core/index.ts');
    const runtimeApi = await import('../src/runtime/index.ts');
    const engineApi = await import('../src/engine/index.ts');
    const flowApi = await import('../src/flow/index.ts');
    const notificationsApi = await import('../src/notifications/index.ts');

    expect(Object.keys(rootApi).sort()).toEqual([
      'AgentLauncher',
      'CapabilityMismatchError',
      'CheckpointManager',
      'ClaudeBackend',
      'CopilotBackend',
      'CostEstimator',
      'CyclicDependencyError',
      'FileSystemCheckpointStore',
      'FleetCheckpointManager',
      'FleetEventBus',
      'FleetProgressWriter',
      'FlowContractError',
      'FlowCycleError',
      'FlowExecutionError',
      'FlowRunner',
      'HostProvider',
      'HostSession',
      'IssueDag',
      'IssueProgressWriter',
      'LogProvider',
      'Logger',
      'NotificationManager',
      'ParallelExecutor',
      'PhaseRegistry',
      'PreRunValidationSuite',
      'ProviderRegistry',
      'RetryExecutor',
      'SerialExecutor',
      'SessionQueue',
      'SlackProvider',
      'TaskQueue',
      'TokenTracker',
      'WebhookProvider',
      'WorkItemDag',
      'baselineResultsSchema',
      'buildGateMap',
      'buildRegistry',
      'captureBaseline',
      'clearGatePlugins',
      'computeRegressions',
      'conditional',
      'createAgentBackend',
      'defineContract',
      'defineFlow',
      'diskValidator',
      'ensureValidAgentBackendName',
      'exec',
      'execShell',
      'extractCadreJson',
      'extractCadreJsonTyped',
      'extractCadreJsonWithError',
      'extractFailures',
      'fromContext',
      'fromStep',
      'fromSteps',
      'gate',
      'getAgentBackendOptions',
      'getPhase',
      'getPhaseCount',
      'getPhaseSubset',
      'getTrackedProcessCount',
      'hasAgentBackendFactory',
      'hasNotificationProviderFactory',
      'isCopilotCliInvocationError',
      'isLastPhase',
      'killAllTrackedProcesses',
      'launchWithRetry',
      'listAgentBackendFactories',
      'listGatePlugins',
      'listNotificationProviderFactories',
      'loop',
      'negotiatePolicy',
      'normalizeAgentBackendName',
      'parallel',
      'phaseNames',
      'registerAgentBackendFactory',
      'registerAgentBackends',
      'registerGatePlugin',
      'registerNotificationProviderFactory',
      'resetAgentBackendFactories',
      'resetNotificationProviderFactories',
      'spawnProcess',
      'step',
      'stripVSCodeEnv',
      'trackProcess',
      'unregisterAgentBackendFactory',
      'unregisterGatePlugin',
      'unregisterNotificationProviderFactory',
      'validateFlowContracts',
      'verifyCommand',
    ]);

    expect(Object.keys(coreApi).sort()).toEqual([
      'CostEstimator',
      'FleetEventBus',
      'Logger',
      'PreRunValidationSuite',
      'diskValidator',
    ]);

    expect(Object.keys(runtimeApi).sort()).toEqual([
      'AgentLauncher',
      'CapabilityMismatchError',
      'ClaudeBackend',
      'CopilotBackend',
      'HostProvider',
      'HostSession',
      'ProviderRegistry',
      'RetryExecutor',
      'TokenTracker',
      'baselineResultsSchema',
      'captureBaseline',
      'computeRegressions',
      'createAgentBackend',
      'defineContract',
      'ensureValidAgentBackendName',
      'exec',
      'execShell',
      'extractCadreJson',
      'extractCadreJsonTyped',
      'extractCadreJsonWithError',
      'extractFailures',
      'getAgentBackendOptions',
      'getTrackedProcessCount',
      'hasAgentBackendFactory',
      'isCopilotCliInvocationError',
      'killAllTrackedProcesses',
      'launchWithRetry',
      'listAgentBackendFactories',
      'negotiatePolicy',
      'normalizeAgentBackendName',
      'registerAgentBackendFactory',
      'registerAgentBackends',
      'resetAgentBackendFactories',
      'spawnProcess',
      'stripVSCodeEnv',
      'trackProcess',
      'unregisterAgentBackendFactory',
      'verifyCommand',
    ]);

    expect(Object.keys(engineApi).sort()).toEqual([
      'CheckpointManager',
      'CyclicDependencyError',
      'FileSystemCheckpointStore',
      'FleetCheckpointManager',
      'FleetProgressWriter',
      'IssueDag',
      'IssueProgressWriter',
      'ParallelExecutor',
      'PhaseRegistry',
      'RetryExecutor',
      'SerialExecutor',
      'SessionQueue',
      'TaskQueue',
      'WorkItemDag',
      'buildGateMap',
      'buildRegistry',
      'clearGatePlugins',
      'getPhase',
      'getPhaseCount',
      'getPhaseSubset',
      'isLastPhase',
      'listGatePlugins',
      'phaseNames',
      'registerGatePlugin',
      'unregisterGatePlugin',
    ]);

    expect(Object.keys(flowApi).sort()).toEqual([
      'FlowContractError',
      'FlowCycleError',
      'FlowExecutionError',
      'FlowRunner',
      'conditional',
      'defineFlow',
      'fromContext',
      'fromStep',
      'fromSteps',
      'gate',
      'loop',
      'parallel',
      'step',
      'validateFlowContracts',
    ]);

    expect(Object.keys(notificationsApi).sort()).toEqual([
      'LogProvider',
      'NotificationManager',
      'SlackProvider',
      'WebhookProvider',
      'hasNotificationProviderFactory',
      'listNotificationProviderFactories',
      'registerNotificationProviderFactory',
      'resetNotificationProviderFactories',
      'unregisterNotificationProviderFactory',
    ]);
  });
});
