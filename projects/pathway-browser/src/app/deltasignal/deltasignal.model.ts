export interface DeltaSignalPathway {
  id: string;
  stable_id: string;
  name: string;
}

interface DeltaSignalNode {
  uuid: string;
  name: string;
  reactome_id: string;
  entity_type: string;
  baseline: number;
  set_id: string | null;
}

export interface DeltaSignalEdge {
  parent_uuid: string;
  child_uuid: string;
  is_and: boolean;
  is_positive: boolean;
  stoichiometry: number;
  edge_type: string;
}

export interface DeltaSignalNetwork {
  status: 'success';
  message: string;
  network_id: string;
  nodes: DeltaSignalNode[];
  edges: DeltaSignalEdge[];
  pathways: { id: string; name: string; members: string[] }[];
}

export interface DeltaSignalSolveResult {
  status: 'success';
  message: string;
  node_activities: Record<string, number>;
  influence_scores: Record<string, number>;
  converged: boolean;
  iterations: number;
  solve_time: number;
}

export interface DeltaSignalPerturbation {
  reactomeId: string;
  name: string;
  activity: number;
  nodeUuids: string[];
}

export interface DeltaSignalResultRow {
  uuid: string;
  reactomeId: string;
  name: string;
  baseline: number;
  activity: number;
  change: number;
  influence: number;
  perturbed: boolean;
}

export type DeltaSignalStatus = 'idle' | 'loading' | 'ready' | 'solving' | 'error';
