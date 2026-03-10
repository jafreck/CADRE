import { describe, expect, it } from 'vitest';
import { condenseWorkItemGraph } from '../../../src/engine/scheduler/graph-condensation.js';
import type { WorkItem } from '../../../src/engine/types.js';

function makeIssue(number: number): WorkItem {
  return {
    number,
    title: `Issue ${number}`,
    body: '',
    labels: [],
    assignees: [],
    comments: [],
    state: 'open',
    createdAt: '',
    updatedAt: '',
    linkedPRs: [],
  };
}

describe('condenseWorkItemGraph', () => {
  it('returns an empty graph for empty input', () => {
    expect(condenseWorkItemGraph([], {})).toEqual({
      components: [],
      depMap: {},
      itemToComponentId: {},
    });
  });

  it('keeps acyclic graphs as one component per work item', () => {
    const graph = condenseWorkItemGraph(
      [makeIssue(1), makeIssue(2), makeIssue(3)],
      { 1: [2], 2: [3], 3: [] },
    );

    expect(graph.components.map((component) => component.itemNumbers)).toEqual([[1], [2], [3]]);
    expect(graph.components.every((component) => component.isCycle === false)).toBe(true);
    expect(graph.depMap).toEqual({
      'component:1': ['component:2'],
      'component:2': ['component:3'],
      'component:3': [],
    });
    expect(graph.itemToComponentId).toEqual({
      1: 'component:1',
      2: 'component:2',
      3: 'component:3',
    });
  });

  it('collapses a multi-node cycle into a single component', () => {
    const graph = condenseWorkItemGraph(
      [makeIssue(1), makeIssue(2), makeIssue(3), makeIssue(4)],
      { 1: [2], 2: [1, 3], 3: [4], 4: [] },
    );

    expect(graph.components.map((component) => ({
      id: component.id,
      itemNumbers: component.itemNumbers,
      isCycle: component.isCycle,
    }))).toEqual([
      { id: 'component:1-2', itemNumbers: [1, 2], isCycle: true },
      { id: 'component:3', itemNumbers: [3], isCycle: false },
      { id: 'component:4', itemNumbers: [4], isCycle: false },
    ]);

    expect(graph.depMap).toEqual({
      'component:1-2': ['component:3'],
      'component:3': ['component:4'],
      'component:4': [],
    });
    expect(graph.itemToComponentId).toEqual({
      1: 'component:1-2',
      2: 'component:1-2',
      3: 'component:3',
      4: 'component:4',
    });
  });

  it('treats a self-loop as a cyclic component but removes the self-edge from the DAG', () => {
    const graph = condenseWorkItemGraph(
      [makeIssue(1), makeIssue(2)],
      { 1: [1, 2], 2: [] },
    );

    expect(graph.components).toHaveLength(2);
    expect(graph.components[0]).toMatchObject({
      id: 'component:1',
      itemNumbers: [1],
      isCycle: true,
    });
    expect(graph.depMap).toEqual({
      'component:1': ['component:2'],
      'component:2': [],
    });
  });

  it('ignores dependency references to unknown work items', () => {
    const graph = condenseWorkItemGraph(
      [makeIssue(10)],
      { 10: [999] },
    );

    expect(graph.components).toHaveLength(1);
    expect(graph.depMap).toEqual({ 'component:10': [] });
    expect(graph.itemToComponentId).toEqual({ 10: 'component:10' });
  });
});
