import { describe, expect, it } from 'vitest';
import {
  buildLogicGraph,
  buildObservations,
  groupChangesByReactomeId,
  fragilityAtFloor,
  resultRows,
} from './deltasignal.utils';
import type {
  DeltaSignalNetwork,
  DeltaSignalPerturbation,
  DeltaSignalSolveResult,
} from './deltasignal.model';

const network: DeltaSignalNetwork = {
  status: 'success',
  message: 'ok',
  network_id: 'pw:test',
  edges: [
    {
      parent_uuid: 'a',
      child_uuid: 'b',
      is_and: true,
      is_positive: false,
      stoichiometry: 1,
      edge_type: 'input',
    },
  ],
  pathways: [],
  nodes: [
    {
      uuid: 'a',
      name: 'ATM one',
      reactome_id: 'R-HSA-1',
      entity_type: 'protein',
      baseline: 0.01,
      set_id: null,
    },
    {
      uuid: 'b',
      name: 'ATM two',
      reactome_id: 'R-HSA-1',
      entity_type: 'protein',
      baseline: 0.01,
      set_id: null,
    },
  ],
};

const perturbation: DeltaSignalPerturbation = {
  reactomeId: 'R-HSA-1',
  name: 'ATM',
  activity: 80,
  nodeUuids: ['a', 'b'],
  basis: 'root',
};

const result: DeltaSignalSolveResult = {
  status: 'success',
  message: 'ok',
  node_activities: { a: 0.8, b: 0.25 },
  influence_scores: { a: 2, b: 5 },
  converged: true,
  iterations: 3,
  solve_time: 0.01,
};

describe('DeltaSignal result mapping', () => {
  it('applies one entity perturbation to every matching logic-network UUID', () => {
    expect(buildObservations([perturbation])).toEqual({
      a: [80, 1],
      b: [80, 1],
    });
  });

  it('converts solver output to the UI scale and ranks by influence', () => {
    const rows = resultRows(network, result, [perturbation]);

    expect(rows.map((row) => row.uuid)).toEqual(['b', 'a']);
    expect(rows[0]).toMatchObject({ baseline: 1, activity: 25, change: 24, perturbed: true });
  });

  it('preserves all changes when several network nodes map to one diagram entity', () => {
    const grouped = groupChangesByReactomeId(resultRows(network, result, [perturbation]));

    expect(grouped.get('R-HSA-1')).toEqual([24, 79]);
  });

  it('keeps logic UUIDs separate and retains edges between visible nodes', () => {
    const graph = buildLogicGraph(network, resultRows(network, result, [perturbation]), 1);

    // Both perturbed UUIDs remain visible even though the ordinary limit is one.
    expect(graph.nodes.map((node) => node.uuid)).toEqual(['a', 'b']);
    expect(graph.nodes.every((node) => node.mappingMultiplicity === 2)).toBe(true);
    expect(graph.edges).toEqual([network.edges[0]]);
  });
});

// deltasignal specs/157 (WA specs/029): the fragility display floor.
describe('fragilityAtFloor', () => {
  it('names the class at or above the floor and is silent below it', () => {
    expect(fragilityAtFloor({ rate: 0.14, n: 1436 })).toEqual({ rate: 0.14, n: 1436 });
    expect(fragilityAtFloor({ rate: 0.05, n: 100 })).toEqual({ rate: 0.05, n: 100 });
    expect(fragilityAtFloor({ rate: 0.006, n: 17312 })).toBeNull();
    expect(fragilityAtFloor(null)).toBeNull();
  });
});
