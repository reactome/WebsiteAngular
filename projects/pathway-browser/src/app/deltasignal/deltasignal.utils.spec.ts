import { describe, expect, it } from 'vitest';
import {
  aggregateRowsByReactomeId,
  buildObservations,
  groupChangesByReactomeId,
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
  edges: [],
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

  it('collapses internal duplicates to one Reactome entity in the result table', () => {
    const aggregated = aggregateRowsByReactomeId(resultRows(network, result, [perturbation]));

    expect(aggregated).toHaveLength(1);
    expect(aggregated[0]).toMatchObject({
      reactomeId: 'R-HSA-1',
      baseline: 1,
      activity: 52.5,
      change: 51.5,
      influence: 5,
      perturbed: true,
    });
  });
});
