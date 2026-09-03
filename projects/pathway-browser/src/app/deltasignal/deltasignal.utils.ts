import {
  DeltaSignalEdge,
  DeltaSignalNetwork,
  DeltaSignalPerturbation,
  DeltaSignalResultRow,
  DeltaSignalSolveResult,
} from './deltasignal.model';

const toDisplayActivity = (activity: number) => activity * 100;

export interface DeltaSignalLogicGraphNode extends DeltaSignalResultRow {
  entityType: string;
  mappingMultiplicity: number;
}

export interface DeltaSignalLogicGraph {
  nodes: DeltaSignalLogicGraphNode[];
  edges: DeltaSignalEdge[];
}

export function buildObservations(
  perturbations: Iterable<DeltaSignalPerturbation>
): Record<string, [number, number]> {
  return Object.fromEntries(
    [...perturbations].flatMap((perturbation) =>
      perturbation.nodeUuids.map((uuid) => [uuid, [perturbation.activity, 1] as [number, number]])
    )
  );
}

export function resultRows(
  network: DeltaSignalNetwork | null,
  result: DeltaSignalSolveResult | null,
  perturbations: Iterable<DeltaSignalPerturbation>
): DeltaSignalResultRow[] {
  if (!network || !result) return [];

  const perturbedUuids = new Set([...perturbations].flatMap((item) => item.nodeUuids));
  return network.nodes
    .filter((node) => result.node_activities[node.uuid] !== undefined)
    .map((node) => {
      const baseline = toDisplayActivity(node.baseline);
      const activity = toDisplayActivity(result.node_activities[node.uuid]);
      return {
        uuid: node.uuid,
        reactomeId: node.reactome_id,
        name: node.name,
        baseline,
        activity,
        change: activity - baseline,
        influence: result.influence_scores[node.uuid] ?? 0,
        perturbed: perturbedUuids.has(node.uuid),
      };
    })
    .sort((a, b) => b.influence - a.influence || Math.abs(b.change) - Math.abs(a.change));
}

/**
 * A Reactome diagram entity can expand to several logic-network nodes. Keep
 * their individual changes so sets can be rendered as a multi-colour gradient
 * rather than silently choosing one member.
 */
export function groupChangesByReactomeId(rows: DeltaSignalResultRow[]): Map<string, number[]> {
  const grouped = new Map<string, number[]>();
  for (const row of rows) {
    if (!row.reactomeId) continue;
    const values = grouped.get(row.reactomeId) ?? [];
    values.push(row.change);
    grouped.set(row.reactomeId, values);
  }
  return grouped;
}

/** Collapse internal solver duplicates for a readable one-entity-per-row table. */
export function aggregateRowsByReactomeId(rows: DeltaSignalResultRow[]): DeltaSignalResultRow[] {
  const grouped = new Map<string, DeltaSignalResultRow[]>();
  for (const row of rows) {
    if (!row.reactomeId) continue;
    grouped.set(row.reactomeId, [...(grouped.get(row.reactomeId) ?? []), row]);
  }

  const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / values.length;
  return [...grouped.entries()]
    .map(([reactomeId, members]) => ({
      uuid: reactomeId,
      reactomeId,
      name: [...new Set(members.map((member) => member.name))].join(' / '),
      baseline: mean(members.map((member) => member.baseline)),
      activity: mean(members.map((member) => member.activity)),
      change: mean(members.map((member) => member.change)),
      influence: Math.max(...members.map((member) => member.influence)),
      perturbed: members.some((member) => member.perturbed),
    }))
    .sort((a, b) => Math.abs(b.change) - Math.abs(a.change) || b.influence - a.influence);
}

/**
 * Keep the largest logic-node responses as separate UUIDs, including every
 * perturbed node even when it falls outside the display limit. Edges are only
 * retained when both endpoints are visible, so the graph never implies a
 * connection through a node that has been omitted.
 */
export function buildLogicGraph(
  network: DeltaSignalNetwork | null,
  rows: DeltaSignalResultRow[],
  limit = 40
): DeltaSignalLogicGraph {
  if (!network || !rows.length || limit < 1) return { nodes: [], edges: [] };

  const ranked = [...rows].sort(
    (a, b) => Math.abs(b.change) - Math.abs(a.change) || b.influence - a.influence
  );
  const selected = ranked.slice(0, limit);
  const selectedIds = new Set(selected.map((row) => row.uuid));
  for (const row of ranked) {
    if (row.perturbed && !selectedIds.has(row.uuid)) {
      selected.push(row);
      selectedIds.add(row.uuid);
    }
  }

  const networkNodes = new Map(network.nodes.map((node) => [node.uuid, node]));
  const multiplicities = new Map<string, number>();
  for (const row of rows) {
    if (!row.reactomeId) continue;
    multiplicities.set(row.reactomeId, (multiplicities.get(row.reactomeId) ?? 0) + 1);
  }

  return {
    nodes: selected.map((row) => ({
      ...row,
      entityType: networkNodes.get(row.uuid)?.entity_type ?? 'unknown',
      mappingMultiplicity: multiplicities.get(row.reactomeId) ?? 1,
    })),
    edges: network.edges.filter(
      (edge) => selectedIds.has(edge.parent_uuid) && selectedIds.has(edge.child_uuid)
    ),
  };
}
