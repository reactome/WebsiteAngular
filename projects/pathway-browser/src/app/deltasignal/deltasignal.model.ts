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
  /** How far from steady state the solve stopped (deltasignal specs/142: a
   *  non-converged answer is cap-decided, not a steady state — say so). */
  residual?: number;
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

/**
 * How a readout query resolved (deltasignal specs/141): a direct node match;
 * the flux of the entity's proxy reactions (a curated species the generator
 * expanded into variants has no node of its own); its set members; or not at
 * all. Every benchmark figure read entities through this ladder with each
 * curated entity weighed once — never a flat mean over matching node copies.
 */
type DeltaSignalReadoutBasis = 'direct' | 'proxy' | 'set_members' | 'none';

interface DeltaSignalReadoutResult {
  id: string | null;
  mode: 'forms' | 'abundance';
  basis: DeltaSignalReadoutBasis;
  groups: string[][];
  pinned: string[];
  value?: number | null;
  fold?: number | null;
  call?: 'up' | 'down' | 'normal' | null;
  /** deltasignal specs/142: true when the fold is at the model's stop — a
   *  switch state, not a measured magnitude. Null exactly where fold is. */
  railed?: boolean | null;
}

export interface DeltaSignalReadoutsResponse {
  status: 'success';
  protocol: {
    ko_agg: string;
    total_readout: string;
    baseline: number;
    down_cutoff: number;
    up_cutoff: number;
    /** The rail stops the railed flag was computed with (specs/142) —
     *  rendered, never hardcoded client-side. */
    rail_low?: number;
    rail_high?: number;
  };
  missing_tables: string[];
  malformed_tables: string[];
  results: DeltaSignalReadoutResult[];
}

/** One entity row of the results table, built from `/api/readouts`. */
export interface DeltaSignalReadoutRow {
  reactomeId: string;
  name: string;
  basis: DeltaSignalReadoutBasis;
  fold: number;
  call: 'up' | 'down' | 'normal';
  railed: boolean;
  influence: number;
  perturbed: boolean;
}

/** The served scope statement (deltasignal specs/143), rendered verbatim. */
export interface DeltaSignalScopeResponse {
  status: 'success';
  statement: {
    version: string;
    provenance_build: string;
    summary: string[];
    validated: {
      axis: string;
      statement: string;
      value: string;
      catalog_build: string;
      solver_commit: string;
      date: string;
      spec: string;
    }[];
    limitations: { name: string; statement: string; spec: string }[];
    protocols: { name: string; endpoint: string; statement: string; spec: string }[];
  };
  served_catalog: string | null;
  measured_on_served_catalog: boolean;
}

/** The scope statement for this session, or why there is none. */
export interface DeltaSignalScopeState {
  status: 'idle' | 'loading' | 'ready' | 'error';
  scope: DeltaSignalScopeResponse | null;
}

/** The readout batch for the current solve, or why there is none. */
export interface DeltaSignalReadoutState {
  status: 'idle' | 'loading' | 'ready' | 'error';
  byId: Map<string, DeltaSignalReadoutResult>;
  protocol: DeltaSignalReadoutsResponse['protocol'] | null;
  message: string | null;
}
