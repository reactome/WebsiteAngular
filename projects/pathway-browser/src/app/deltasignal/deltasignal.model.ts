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

/**
 * One pinned node from `/api/pins`: a ROOT of the logic network that is, or
 * contains, the perturbed entity. Every DeltaSignal benchmark figure was
 * measured by pinning exactly these and computing every downstream copy
 * (deltasignal specs/140); pinning anything else runs a protocol those
 * figures do not apply to.
 */
interface DeltaSignalPin {
  uuid: string;
  name: string;
}

/**
 * How a query resolved: at true roots; through the catalytic-cycle fallback
 * (the entity has no root because its own cycle regenerates it); or not at
 * all — the entity has no perturbable starting form in this network.
 */
type DeltaSignalPinBasis = 'root' | 'root_cycle' | 'none';

export interface DeltaSignalPinResult {
  id: string | null;
  pins: DeltaSignalPin[];
  basis: DeltaSignalPinBasis;
  occurrences: number;
}

export interface DeltaSignalPinsResponse {
  status: 'success';
  protocol: { pin_scope: string; root_ignore: string };
  results: DeltaSignalPinResult[];
}

/** The resolution state for the entity selected on the diagram. */
export interface DeltaSignalPinState {
  status: 'idle' | 'loading' | 'ready' | 'error';
  reactomeId: string | null;
  result: DeltaSignalPinResult | null;
  message: string | null;
}

export interface DeltaSignalPerturbation {
  reactomeId: string;
  name: string;
  activity: number;
  nodeUuids: string[];
  basis: DeltaSignalPinBasis;
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
