/**
 * Directed Acyclic Graph of work items, supporting topological wave computation
 * and transitive dependency resolution via Kahn's algorithm.
 *
 * Dependencies are expressed as: depMap[itemNumber] = [list of item numbers this item depends on].
 * A work item in wave N means all its dependencies appear in waves 0..N-1.
 */

import { CyclicDependencyError, type WorkItem } from '../types.js';

export class WorkItemDag<TWorkItem extends WorkItem = WorkItem> {
  private readonly items: Map<number, TWorkItem>;
  private readonly depMap: Record<number, number[]>;
  private readonly waves: TWorkItem[][];
  /** Topological order: index of each work item number → its position in the sorted order */
  private readonly topoOrder: number[];

  constructor(items: TWorkItem[], depMap: Record<number, number[]>) {
    this.items = new Map(items.map((i) => [i.number, i]));
    // Normalize depMap: only include entries for issues we know about
    this.depMap = depMap;
    this.topoOrder = [];
    this.waves = this.computeWaves();
  }

  private computeWaves(): TWorkItem[][] {
    const issueNumbers = [...this.items.keys()];

    // Build in-degree and adjacency list (edges go from dependency → dependent)
    const inDegree = new Map<number, number>();
    // dependents[n] = list of issues that depend on n
    const dependents = new Map<number, number[]>();

    for (const num of issueNumbers) {
      inDegree.set(num, 0);
      dependents.set(num, []);
    }

    for (const num of issueNumbers) {
      const deps = this.depMap[num] ?? [];
      for (const dep of deps) {
        if (!this.items.has(dep)) continue; // ignore deps not in our issue set
        inDegree.set(num, (inDegree.get(num) ?? 0) + 1);
        dependents.get(dep)!.push(num);
      }
    }

    // Kahn's algorithm with wave tracking
    const waves: TWorkItem[][] = [];
    let currentQueue = issueNumbers.filter((n) => inDegree.get(n) === 0);
    const processed = new Set<number>();

    while (currentQueue.length > 0) {
      const wave: TWorkItem[] = [];
      const nextQueue: number[] = [];

      for (const num of currentQueue) {
        wave.push(this.items.get(num)!);
        this.topoOrder.push(num);
        processed.add(num);

        for (const dep of dependents.get(num) ?? []) {
          const newDeg = (inDegree.get(dep) ?? 0) - 1;
          inDegree.set(dep, newDeg);
          if (newDeg === 0) {
            nextQueue.push(dep);
          }
        }
      }

      waves.push(wave);
      currentQueue = nextQueue;
    }

    // If not all issues were processed, there is a cycle
    if (processed.size !== issueNumbers.length) {
      const cycleParticipants = issueNumbers.filter((n) => !processed.has(n));
      throw new CyclicDependencyError(
        `Cyclic dependency detected among work items: ${cycleParticipants.join(', ')}`,
        cycleParticipants,
      );
    }

    return waves;
  }

  /** Returns work items grouped into waves; wave 0 has no dependencies. */
  getWaves(): TWorkItem[][] {
    return this.waves;
  }

  /** Returns all work items in the DAG. */
  getAllItems(): TWorkItem[] {
    return [...this.items.values()];
  }

  /** @deprecated Use getAllItems(). */
  getAllIssues(): TWorkItem[] {
    return this.getAllItems();
  }

  /**
   * Returns the direct dependency item numbers for the given item
   * (only those present in the DAG's issue set).
   */
  getDirectDeps(itemNumber: number): number[] {
    return (this.depMap[itemNumber] ?? []).filter((n) => this.items.has(n));
  }

  /**
   * Returns all transitive dependencies of the given item in topological order
   * (deepest/earliest dependencies first).
   */
  getTransitiveDepsOrdered(itemNumber: number): TWorkItem[] {
    const visited = new Set<number>();
    const collect = (num: number): void => {
      const deps = this.depMap[num] ?? [];
      for (const dep of deps) {
        if (!this.items.has(dep) || visited.has(dep)) continue;
        collect(dep);
        visited.add(dep);
      }
    };
    collect(itemNumber);

    // Return in topological order (topoOrder was built during wave computation)
    return this.topoOrder
      .filter((n) => visited.has(n))
      .map((n) => this.items.get(n)!);
  }
}

/** @deprecated Use WorkItemDag<TWorkItem>. */
export class IssueDag<TWorkItem extends WorkItem = WorkItem> extends WorkItemDag<TWorkItem> {}
