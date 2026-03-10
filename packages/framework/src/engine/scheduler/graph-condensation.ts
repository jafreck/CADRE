import type {
  CondensedWorkItemComponent,
  CondensedWorkItemGraph,
  WorkItem,
} from '../types.js';

/**
 * Condense an arbitrary directed work-item dependency graph into a DAG by
 * collapsing strongly connected components into composite nodes.
 *
 * Dependency semantics match {@link WorkItemDag}: `depMap[a] = [b, c]` means
 * work item `a` depends on `b` and `c`.
 */
export function condenseWorkItemGraph<TWorkItem extends WorkItem>(
  items: TWorkItem[],
  depMap: Record<number, number[]>,
): CondensedWorkItemGraph<TWorkItem> {
  if (items.length === 0) {
    return {
      components: [],
      depMap: {},
      itemToComponentId: {},
    };
  }

  const itemMap = new Map(items.map((item) => [item.number, item]));
  const itemNumbers = [...itemMap.keys()].sort((a, b) => a - b);
  const adjacency = new Map<number, number[]>();

  for (const itemNumber of itemNumbers) {
    const deps = (depMap[itemNumber] ?? [])
      .filter((dep) => itemMap.has(dep));
    adjacency.set(itemNumber, deps);
  }

  const indexByNode = new Map<number, number>();
  const lowLinkByNode = new Map<number, number>();
  const stack: number[] = [];
  const onStack = new Set<number>();
  const rawComponents: number[][] = [];
  let nextIndex = 0;

  const strongConnect = (node: number): void => {
    indexByNode.set(node, nextIndex);
    lowLinkByNode.set(node, nextIndex);
    nextIndex += 1;
    stack.push(node);
    onStack.add(node);

    for (const dep of adjacency.get(node) ?? []) {
      if (!indexByNode.has(dep)) {
        strongConnect(dep);
        lowLinkByNode.set(
          node,
          Math.min(lowLinkByNode.get(node) ?? Number.POSITIVE_INFINITY, lowLinkByNode.get(dep) ?? Number.POSITIVE_INFINITY),
        );
      } else if (onStack.has(dep)) {
        lowLinkByNode.set(
          node,
          Math.min(lowLinkByNode.get(node) ?? Number.POSITIVE_INFINITY, indexByNode.get(dep) ?? Number.POSITIVE_INFINITY),
        );
      }
    }

    if (lowLinkByNode.get(node) !== indexByNode.get(node)) {
      return;
    }

    const component: number[] = [];
    while (stack.length > 0) {
      const current = stack.pop()!;
      onStack.delete(current);
      component.push(current);
      if (current === node) {
        break;
      }
    }

    component.sort((a, b) => a - b);
    rawComponents.push(component);
  };

  for (const itemNumber of itemNumbers) {
    if (!indexByNode.has(itemNumber)) {
      strongConnect(itemNumber);
    }
  }

  const componentsWithSortKey = rawComponents.map((componentNumbers) => {
    const id = `component:${componentNumbers.join('-')}`;
    const isSelfLoop = componentNumbers.length === 1
      && (adjacency.get(componentNumbers[0]) ?? []).includes(componentNumbers[0]);
    const component: CondensedWorkItemComponent<TWorkItem> = {
      id,
      itemNumbers: componentNumbers,
      items: componentNumbers.map((itemNumber) => itemMap.get(itemNumber)!),
      isCycle: componentNumbers.length > 1 || isSelfLoop,
    };

    return {
      component,
      sortKey: componentNumbers[0],
    };
  }).sort((a, b) => a.sortKey - b.sortKey);

  const components = componentsWithSortKey.map((entry) => entry.component);
  const itemToComponentId: Record<number, string> = {};
  const componentSortOrder = new Map<string, number>();

  for (let i = 0; i < components.length; i += 1) {
    const component = components[i];
    componentSortOrder.set(component.id, i);
    for (const itemNumber of component.itemNumbers) {
      itemToComponentId[itemNumber] = component.id;
    }
  }

  const condensedDepMap: Record<string, string[]> = {};
  for (const component of components) {
    const deps = new Set<string>();
    for (const itemNumber of component.itemNumbers) {
      for (const dep of adjacency.get(itemNumber) ?? []) {
        const depComponentId = itemToComponentId[dep];
        if (depComponentId && depComponentId !== component.id) {
          deps.add(depComponentId);
        }
      }
    }

    condensedDepMap[component.id] = [...deps].sort(
      (left, right) => (componentSortOrder.get(left) ?? 0) - (componentSortOrder.get(right) ?? 0),
    );
  }

  return {
    components,
    depMap: condensedDepMap,
    itemToComponentId,
  };
}
