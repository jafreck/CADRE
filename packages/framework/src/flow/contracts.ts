import {
  ZodAny,
  ZodArray,
  ZodDefault,
  ZodDiscriminatedUnion,
  ZodEffects,
  ZodEnum,
  ZodLiteral,
  ZodNativeEnum,
  ZodNullable,
  ZodNumber,
  ZodObject,
  ZodOptional,
  ZodString,
  ZodType,
  ZodTypeAny,
  ZodUnion,
  ZodUnknown,
  ZodBoolean,
  ZodNull,
  ZodUndefined,
} from 'zod';
import type {
  DataRef,
  FlowContractIssue,
  FlowContractValidationResult,
  FlowContracts,
  FlowDefinition,
  FlowNode,
  StepContract,
} from './types.js';

export interface IndexedNode {
  id: string;
  input?: unknown;
  inputSchema?: ZodTypeAny;
  outputSchema?: ZodTypeAny;
}

export interface IndexedFlow {
  nodes: Map<string, IndexedNode>;
}

export function validateFlowContracts<TContext = Record<string, unknown>>(
  flow: FlowDefinition<TContext>,
  contracts?: FlowContracts,
): FlowContractValidationResult {
  const issues: FlowContractIssue[] = [];
  const mergedContracts = mergeContracts(flow.contracts, contracts);
  const indexed = indexFlow(flow);

  for (const [, node] of indexed.nodes) {
    if (!node.input) {
      continue;
    }
    const refs = collectRefs(node.input, 'input');
    for (const ref of refs) {
      if (ref.ref.kind === 'fromContext') {
        continue;
      }
      if (ref.ref.kind === 'fromStep') {
        issues.push(
          ...validateSingleRef({
            fromStep: ref.ref.stepId,
            toStep: node.id,
            fieldPath: ref.fieldPath,
            refPath: ref.ref.path,
            consumerPath: ref.fieldPath,
            mergedContracts,
            indexed,
          }),
        );
        continue;
      }
      for (const fromStep of ref.ref.stepIds) {
        const stepFieldPath = `${ref.fieldPath}.${fromStep}`;
        issues.push(
          ...validateSingleRef({
            fromStep,
            toStep: node.id,
            fieldPath: stepFieldPath,
            refPath: ref.ref.path,
            consumerPath: stepFieldPath,
            mergedContracts,
            indexed,
          }),
        );
      }
    }
  }

  return {
    valid: issues.length === 0,
    issues,
  };
}

export function mergeContracts(
  flowContracts?: FlowContracts,
  runtimeContracts?: FlowContracts,
): FlowContracts {
  return {
    ...(flowContracts ?? {}),
    ...(runtimeContracts ?? {}),
  };
}

export function getContractForStep(
  stepId: string,
  indexed: IndexedFlow,
  mergedContracts: FlowContracts,
): StepContract<unknown, unknown> {
  const node = indexed.nodes.get(stepId);
  const fromNode: StepContract<unknown, unknown> = {
    inputSchema: node?.inputSchema,
    outputSchema: node?.outputSchema,
  };
  const fromContracts = mergedContracts[stepId] ?? {};
  return {
    inputSchema: fromNode.inputSchema ?? fromContracts.inputSchema,
    outputSchema: fromNode.outputSchema ?? fromContracts.outputSchema,
  };
}

export function schemaAtPath(schema: ZodTypeAny | undefined, path?: string): ZodTypeAny | undefined {
  if (!schema || !path || path.trim().length === 0) {
    return schema;
  }

  const parts = path.split('.').filter(Boolean);
  let cursor: ZodTypeAny | undefined = schema;

  for (const part of parts) {
    if (!cursor) {
      return undefined;
    }

    const base = unwrapSchema(cursor);

    if (base instanceof ZodObject) {
      const shape = base.shape;
      cursor = shape[part] as ZodTypeAny | undefined;
      continue;
    }

    if (base instanceof ZodArray) {
      const index = Number(part);
      if (Number.isNaN(index)) {
        return undefined;
      }
      cursor = base.element;
      continue;
    }

    return undefined;
  }

  return cursor;
}

function validateSingleRef(params: {
  fromStep: string;
  toStep: string;
  fieldPath: string;
  refPath?: string;
  consumerPath: string;
  mergedContracts: FlowContracts;
  indexed: IndexedFlow;
}): FlowContractIssue[] {
  const { fromStep, toStep, fieldPath, refPath, consumerPath, mergedContracts, indexed } = params;

  if (!indexed.nodes.has(fromStep)) {
    return [
      {
        fromStep,
        toStep,
        fieldPath,
        reason: `Producer step '${fromStep}' does not exist in flow`,
      },
    ];
  }

  const producerContract = getContractForStep(fromStep, indexed, mergedContracts);
  if (!producerContract.outputSchema) {
    return [
      {
        fromStep,
        toStep,
        fieldPath,
        reason: `Producer '${fromStep}' has no output schema`,
      },
    ];
  }

  const consumerContract = getContractForStep(toStep, indexed, mergedContracts);
  if (!consumerContract.inputSchema) {
    return [
      {
        fromStep,
        toStep,
        fieldPath,
        reason: `Consumer '${toStep}' has no input schema`,
      },
    ];
  }

  const producerSchema = schemaAtPath(producerContract.outputSchema, refPath);
  if (!producerSchema) {
    const atPath = refPath && refPath.length > 0 ? refPath : '<root>';
    return [
      {
        fromStep,
        toStep,
        fieldPath,
        reason: `Producer schema path '${atPath}' does not exist`,
      },
    ];
  }

  const consumerSchema = schemaAtPath(consumerContract.inputSchema, consumerPath.replace(/^input\.?/, ''));
  if (!consumerSchema) {
    const atPath = consumerPath.replace(/^input\.?/, '') || '<root>';
    return [
      {
        fromStep,
        toStep,
        fieldPath,
        reason: `Consumer schema path '${atPath}' does not exist`,
      },
    ];
  }

  const mismatchReason = compatibilityReason(producerSchema, consumerSchema);
  if (!mismatchReason) {
    return [];
  }

  return [
    {
      fromStep,
      toStep,
      fieldPath,
      reason: mismatchReason,
    },
  ];
}

function indexFlow<TContext = Record<string, unknown>>(flow: FlowDefinition<TContext>): IndexedFlow {
  const nodes = new Map<string, IndexedNode>();

  const visit = (items: FlowNode<TContext>[]): void => {
    for (const node of items) {
      if (!nodes.has(node.id)) {
        nodes.set(node.id, {
          id: node.id,
          input: node.input,
          inputSchema: 'inputSchema' in node ? node.inputSchema : undefined,
          outputSchema: 'outputSchema' in node ? node.outputSchema : undefined,
        });
      }
      if (node.kind === 'conditional') {
        visit(node.then);
        visit(node.else ?? []);
      }
      if (node.kind === 'loop') {
        visit(node.do);
      }
      if (node.kind === 'parallel') {
        for (const branch of Object.values(node.branches)) {
          visit(branch);
        }
      }
      if (node.kind === 'sequence') {
        visit(node.nodes);
      }
      if (node.kind === 'catch') {
        visit(node.try);
        if (node.finally) visit(node.finally);
      }
    }
  };

  visit(flow.nodes);
  return { nodes };
}

function collectRefs(input: unknown, fieldPath: string): Array<{ ref: DataRef; fieldPath: string }> {
  const refs: Array<{ ref: DataRef; fieldPath: string }> = [];
  const walk = (value: unknown, path: string): void => {
    if (isDataRef(value)) {
      refs.push({ ref: value, fieldPath: path });
      return;
    }

    if (Array.isArray(value)) {
      value.forEach((entry, index) => walk(entry, `${path}.${index}`));
      return;
    }

    if (value && typeof value === 'object') {
      for (const [key, entry] of Object.entries(value)) {
        walk(entry, `${path}.${key}`);
      }
    }
  };

  walk(input, fieldPath);
  return refs;
}

function isDataRef(value: unknown): value is DataRef {
  if (!value || typeof value !== 'object') {
    return false;
  }
  const candidate = value as { kind?: string };
  return candidate.kind === 'fromStep' || candidate.kind === 'fromSteps' || candidate.kind === 'fromContext';
}

function compatibilityReason(source: ZodTypeAny, target: ZodTypeAny): string | undefined {
  const src = unwrapSchema(source);
  const dst = unwrapSchema(target);

  if (dst instanceof ZodAny || dst instanceof ZodUnknown) {
    return undefined;
  }

  if (src instanceof ZodAny || src instanceof ZodUnknown) {
    return undefined;
  }

  if (dst instanceof ZodUnion) {
    const works = (dst.options as ZodTypeAny[]).some((option: ZodTypeAny) => compatibilityReason(src, option) === undefined);
    return works ? undefined : `Source type ${schemaLabel(src)} is incompatible with union target ${schemaLabel(dst)}`;
  }

  if (src instanceof ZodUnion) {
    const incompatible = (src.options as ZodTypeAny[]).find((option: ZodTypeAny) => compatibilityReason(option, dst) !== undefined);
    if (!incompatible) {
      return undefined;
    }
    return `Union source ${schemaLabel(src)} includes incompatible variant ${schemaLabel(incompatible as ZodTypeAny)} for ${schemaLabel(dst)}`;
  }

  if (dst instanceof ZodDiscriminatedUnion) {
    const options = Array.from(dst.options.values()) as ZodTypeAny[];
    const works = options.some((option) => compatibilityReason(src, option) === undefined);
    return works ? undefined : `Source type ${schemaLabel(src)} is incompatible with discriminated union target ${schemaLabel(dst)}`;
  }

  if (src instanceof ZodDiscriminatedUnion) {
    const options = Array.from(src.options.values()) as ZodTypeAny[];
    const incompatible = options.find((option) => compatibilityReason(option, dst) !== undefined);
    if (!incompatible) {
      return undefined;
    }
    return `Discriminated union source ${schemaLabel(src)} includes incompatible variant ${schemaLabel(incompatible)} for ${schemaLabel(dst)}`;
  }

  if (src instanceof ZodLiteral) {
    if (dst instanceof ZodString || dst instanceof ZodNumber || dst instanceof ZodBoolean || dst instanceof ZodNull || dst instanceof ZodUndefined) {
      return undefined;
    }
    if (dst instanceof ZodEnum || dst instanceof ZodNativeEnum) {
      return undefined;
    }
    if (dst instanceof ZodLiteral) {
      return src.value === dst.value ? undefined : `Literal ${String(src.value)} does not match ${String(dst.value)}`;
    }
  }

  if (src.constructor === dst.constructor) {
    if (src instanceof ZodArray && dst instanceof ZodArray) {
      return compatibilityReason(src.element, dst.element);
    }
    if (src instanceof ZodObject && dst instanceof ZodObject) {
      const sourceShape = src.shape;
      const targetShape = dst.shape;
      for (const [key, targetSchema] of Object.entries(targetShape)) {
        const sourceSchema = sourceShape[key] as ZodTypeAny | undefined;
        if (!sourceSchema) {
          const targetIsOptional = unwrapSchema(targetSchema as ZodTypeAny) instanceof ZodOptional;
          if (!targetIsOptional) {
            return `Missing required field '${key}'`;
          }
          continue;
        }
        const mismatch = compatibilityReason(sourceSchema, targetSchema as ZodTypeAny);
        if (mismatch) {
          return `Field '${key}' is incompatible: ${mismatch}`;
        }
      }
      return undefined;
    }
    return undefined;
  }

  return `Type ${schemaLabel(src)} is not assignable to ${schemaLabel(dst)}`;
}

function unwrapSchema(schema: ZodTypeAny): ZodTypeAny {
  if (schema instanceof ZodOptional || schema instanceof ZodNullable || schema instanceof ZodDefault) {
    return unwrapSchema(schema._def.innerType as ZodTypeAny);
  }
  if (schema instanceof ZodEffects) {
    return unwrapSchema(schema._def.schema as ZodTypeAny);
  }
  return schema;
}

function schemaLabel(schema: ZodTypeAny): string {
  const unwrapped = unwrapSchema(schema);
  return unwrapped._def.typeName.replace('Zod', '').toLowerCase();
}
