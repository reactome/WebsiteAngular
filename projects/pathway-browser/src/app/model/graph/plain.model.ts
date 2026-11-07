import type * as Graph from '../../../../../contract/graph-core.ts';

/*
 * The graph's answers in the plain form, as the routes asked without
 * `includeRef=true` write them (research R9): an object the answer has written
 * already is repeated as its dbId, which a reader takes as no object.
 */

/** Any object of the graph, plain (/data/query/{id}, /data/query/enhanced/{id}). */
export type PlainGraphObject = Graph.GraphObject<number>;

/** Any event, plain (an event's ancestors, asked without includeRef). */
export type PlainEvent = Graph.Event<number>;

/** A pathway, plain (/data/pathways/low/entity/{id}). */
export type PlainPathway = Graph.AnyPathway<number>;

/** A reference entity, plain (/data/participants/{id}/referenceEntities). */
export type PlainReferenceEntity = Graph.ReferenceEntity<number>;
