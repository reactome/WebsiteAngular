// The Reacfoam's tree (spec 006 T103, research D25): /data/eventsHierarchy/{species},
// every pathway of a species with its size, and with an analysis token, what the
// analysis found in each.
import type { AnalysisPathway } from './analysis.ts';

/**
 * A pathway of the tree, in the order Java writes its fields. With
 * `pathwaysOnly=true` the tree is the AnalysisService's hierarchy: pathways
 * only, from each top-level pathway down.
 */
export interface EventsHierarchyNode {
  stId: string;
  name: string;
  /** The species' name (its displayName), on every node, however it was asked for. */
  species: string;
  type: 'TopLevelPathway' | 'Pathway' | 'CellLineagePath';
  /** Whether this pathway has a diagram of its own. */
  diagram: boolean;
  /** Lower-level pathway: written with an analysis token only. */
  llp?: boolean;
  /** Distinct identifiers its reactions reach, its subpathways' included. */
  totalEntity: number;
  /** Those with their interaction partners. */
  totalEntityAndInteractors: number;
  /**
   * With an analysis token, on a pathway the analysis found: the analysis's
   * figures as the AnalysisService gives them, except that `exp` is left out
   * when empty, as the content service leaves out empty lists.
   */
  entities?: Omit<AnalysisPathway['entities'], 'exp'> & { exp?: number[] };
  /** With an analysis token, on a pathway the analysis found. */
  reactions?: AnalysisPathway['reactions'];
  /** Left out on a pathway with no subpathways. */
  children?: EventsHierarchyNode[];
}
