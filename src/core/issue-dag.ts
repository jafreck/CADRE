import type { IssueDetail } from '../platform/provider.js';
import { CyclicDependencyError } from '../errors.js';

/**
 * Directed Acyclic Graph of issues, supporting topological wave computation
 * and transitive dependency resolution via Kahn's algorithm.
 *
 * Dependencies are expressed as: depMap[issueNumber] = [list of issue numbers this issue depends on].
 * An issue in wave N means all its dependencies appear in waves 0..N-1.
 */
export class IssueDag {
  private readonly issues: Map<number, IssueDetail>;
  private readonly depMap: Record<number, number[]>;
  private readonly waves: IssueDetail[][];
  /** Topological order: index of each issue number → its position in the sorted order */
  private readonly topoOrder: number[];

  constructor(issues: IssueDetail[], depMap: Record<number, number[]>) {
    this.issues = new Map(issues.map((i) => [i.number, i]));
    // Normalize depMap: only include entries for issues we know about
    this.depMap = depMap;
    this.topoOrder = [];
    this.waves = this.computeWaves();
  }

  private computeWaves(): IssueDetail[][] {
    const issueNumbers = [...this.issues.keys()];

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
        if (!this.issues.has(dep)) continue; // ignore deps not in our issue set
        inDegree.set(num, (inDegree.get(num) ?? 0) + 1);
        dependents.get(dep)!.push(num);
      }
    }

    // Kahn's algorithm with wave tracking
    const waves: IssueDetail[][] = [];
    let currentQueue = issueNumbers.filter((n) => inDegree.get(n) === 0);
    const processed = new Set<number>();

    while (currentQueue.length > 0) {
      const wave: IssueDetail[] = [];
      const nextQueue: number[] = [];

      for (const num of currentQueue) {
        wave.push(this.issues.get(num)!);
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
        `Cyclic dependency detected among issues: ${cycleParticipants.join(', ')}`,
        cycleParticipants,
      );
    }

    return waves;
  }

  /** Returns issues grouped into waves; wave 0 has no dependencies. */
  getWaves(): IssueDetail[][] {
    return this.waves;
  }

  /** Returns all issues in the DAG. */
  getAllIssues(): IssueDetail[] {
    return [...this.issues.values()];
  }

  /**
   * Returns the direct dependency issue numbers for the given issue
   * (only those present in the DAG's issue set).
   */
  getDirectDeps(issueNumber: number): number[] {
    return (this.depMap[issueNumber] ?? []).filter((n) => this.issues.has(n));
  }

  /**
   * Returns all transitive dependencies of the given issue in topological order
   * (deepest/earliest dependencies first).
   */
  getTransitiveDepsOrdered(issueNumber: number): IssueDetail[] {
    const visited = new Set<number>();
    const collect = (num: number): void => {
      const deps = this.depMap[num] ?? [];
      for (const dep of deps) {
        if (!this.issues.has(dep) || visited.has(dep)) continue;
        collect(dep);
        visited.add(dep);
      }
    };
    collect(issueNumber);

    // Return in topological order (topoOrder was built during wave computation)
    return this.topoOrder
      .filter((n) => visited.has(n))
      .map((n) => this.issues.get(n)!);
  }
}
