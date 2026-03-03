import type { DataRef, FlowContracts } from './types.js';

type Primitive = string | number | boolean | bigint | symbol | null | undefined;

type PathFor<T> =
  T extends Primitive
    ? never
    : T extends readonly (infer TEntry)[]
      ? `${number}` | `${number}.${PathFor<TEntry>}`
      : T extends object
        ? {
            [K in Extract<keyof T, string>]: K | `${K}.${PathFor<T[K]>}`;
          }[Extract<keyof T, string>]
        : never;

type PathArg<T> = unknown extends T ? string : PathFor<T>;

type ContractStep<TContracts extends FlowContracts> = Extract<keyof TContracts, string>;

type ContractOutput<TContracts extends FlowContracts, TStep extends ContractStep<TContracts>> =
  TStep extends keyof TContracts
    ? TContracts[TStep] extends { outputSchema?: infer TSchema }
      ? TSchema extends { _output: infer TOutput }
        ? TOutput
        : unknown
      : unknown
    : unknown;

type ContractOutputs<TContracts extends FlowContracts, TStepIds extends readonly ContractStep<TContracts>[]> = {
  [K in TStepIds[number]]: ContractOutput<TContracts, K>;
};

export function fromStep<
  TContracts extends FlowContracts = FlowContracts,
  TStep extends ContractStep<TContracts> = ContractStep<TContracts>,
>(
  stepId: TStep,
  path?: PathArg<ContractOutput<TContracts, TStep>>,
): DataRef<ContractOutput<TContracts, TStep>> {
  return { kind: 'fromStep', stepId, path };
}

export function fromSteps<
  TContracts extends FlowContracts = FlowContracts,
  TStepIds extends readonly ContractStep<TContracts>[] = readonly ContractStep<TContracts>[],
>(stepIds: TStepIds, path?: PathArg<ContractOutput<TContracts, TStepIds[number]>>): DataRef<ContractOutputs<TContracts, TStepIds>> {
  return { kind: 'fromSteps', stepIds, path };
}

export function fromContext<TValue = unknown>(path?: string): DataRef<TValue> {
  return { kind: 'fromContext', path };
}
