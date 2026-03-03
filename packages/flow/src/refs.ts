import type { DataRef, FlowContracts } from './types.js';

type ContractOutput<TContracts extends FlowContracts, TStep extends string> =
  TStep extends keyof TContracts
    ? TContracts[TStep] extends { outputSchema?: infer TSchema }
      ? TSchema extends { _output: infer TOutput }
        ? TOutput
        : unknown
      : unknown
    : unknown;

type ContractOutputs<TContracts extends FlowContracts, TStepIds extends readonly string[]> = {
  [K in TStepIds[number]]: ContractOutput<TContracts, K>;
};

export function fromStep<TContracts extends FlowContracts = FlowContracts, TStep extends string = string>(
  stepId: TStep,
  path?: string,
): DataRef<ContractOutput<TContracts, TStep>> {
  return { kind: 'fromStep', stepId, path };
}

export function fromSteps<
  TContracts extends FlowContracts = FlowContracts,
  TStepIds extends readonly string[] = readonly string[],
>(stepIds: TStepIds, path?: string): DataRef<ContractOutputs<TContracts, TStepIds>> {
  return { kind: 'fromSteps', stepIds, path };
}

export function fromContext<TValue = unknown>(path?: string): DataRef<TValue> {
  return { kind: 'fromContext', path };
}
