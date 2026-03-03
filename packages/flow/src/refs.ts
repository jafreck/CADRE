import type { DataRef } from './types.js';

export function fromStep(stepId: string, path?: string): DataRef {
  return { kind: 'fromStep', stepId, path };
}

export function fromSteps(stepIds: string[], path?: string): DataRef {
  return { kind: 'fromSteps', stepIds, path };
}

export function fromContext(path?: string): DataRef {
  return { kind: 'fromContext', path };
}
