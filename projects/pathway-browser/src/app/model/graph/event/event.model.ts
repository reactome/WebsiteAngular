import { DatabaseObject } from '../database-object.model';
import { Summation } from '../summation.model';
import { ReviewStatus } from '../review-status.model';
import { LiteratureReference } from '../publication/literature-reference.model';
import { InstanceEdit } from '../instance-edit.model';
import type { Relationship } from '../relationship.model';
type HasCompartment = Relationship.HasCompartment;
import { Species } from '../species.model';
import { Disease } from '../external-ontology/disease.model';
import { InDepth } from '../in-depth.model';
import { HasFigure } from '../figure.model';
import { GO_BiologicalProcess } from '../go-term/go-biological-process.model';

/**
 * As /data/query/enhanced sends it, which leaves out what an event has none of:
 * of 15 sampled pathways one had authors, reviewers or a review status, and
 * three of 15 reactions (#344).
 *
 * In that answer (not /enhanced/v2) a list such as `literatureReference` can
 * hold bare dbIds where the object was written earlier in the answer, often in
 * the parent pathway (`eventOf`); the types here do not say so. Dropping them
 * loses references, as production's browser does (#760). Take an event's lists
 * from /enhanced/v2, which writes every object in full.
 */
export interface Event extends DatabaseObject, InDepth, HasFigure {
  stId: string;
  authored?: InstanceEdit[];
  reviewed?: InstanceEdit[];
  literatureReference?: LiteratureReference[];
  isInferred: boolean;
  releaseStatus?: string;
  isInDisease: boolean;
  summation: Summation[];
  reviewStatus?: ReviewStatus;
  name: string[];
  hasCompartment?: HasCompartment[];
  species: Species[];
  speciesName?: string;
  disease?: Disease[];
  goBiologicalProcess?: GO_BiologicalProcess;

  // not from API endpoint but are needed in the tree view
  isSelected?: boolean;
  isHovered?: boolean;
  /** Set by this site once the lineage is known; no answer carries it. */
  ancestors?: Event[];
  /** None for a top-level event. */
  parent?: Event | undefined;
  hit?: boolean;
}
