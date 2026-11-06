/**
 * reaction-exporter's ReactionGraphFactory (research D22, step 4): the graph
 * part of the answer -- the reaction's physical entities with their children
 * and parents, and the reaction itself as the one event -- read with Java's
 * two queries, unchanged.
 *
 * Java maps each row with graph-core's ReflectionUtils.build, field by field
 * of diagram-reader's EntityNodeImpl and EventNodeImpl, by name, so:
 * - a Long field the row lacks or holds null for is 0 (`asLong(0)`), as is
 *   every event's `speciesId`, which the query does not return;
 * - a list field that is null or empty is an empty list: so are an event's
 *   `inhibitors`, `activators` and `requirements`, which the query does not
 *   return either. Its `regulations` match no field and are dropped: no
 *   event in this graph has regulators;
 * - a String field is the row's text, or null.
 */
import neo4j from 'neo4j-driver';
import { read } from '../graph.ts';
import { JavaHashMap } from '../java-hashmap.ts';
import type { Laid } from './algorithm.ts';
import { JavaNullPointerException, JavaRuntimeException } from './model.ts';

/** getGraphNodes' query, joined as Java joins it. */
const ENTITY_NODES_QUERY =
  '' +
  'MATCH (rle:ReactionLikeEvent{dbId:$dbId})-[:input|output|catalystActivity|physicalEntity|entityFunctionalStatus|diseaseEntity|regulatedBy|regulator|hasComponent|hasMember|hasCandidate|repeatedUnit|proteinMarker|RNAMarker*]->(pe:PhysicalEntity) ' +
  'WITH COLLECT(DISTINCT pe) AS pes ' +
  'UNWIND pes AS pe ' +
  'OPTIONAL MATCH (pe)-[:hasComponent|hasMember|hasCandidate|repeatedUnit|proteinMarker|RNAMarker]->(children:PhysicalEntity) ' +
  'OPTIONAL MATCH (parent:PhysicalEntity)-[:hasComponent|hasMember|hasCandidate|repeatedUnit|proteinMarker|RNAMarker]->(pe) ' +
  'WHERE parent IN pes ' +
  'OPTIONAL MATCH (pe)-[:referenceEntity]->(re:ReferenceEntity) ' +
  'OPTIONAL MATCH (pe)-[:species]->(s:Species) ' +
  'RETURN DISTINCT pe.dbId AS dbId, pe.stId AS stId, pe.displayName AS displayName, pe.schemaClass AS schemaClass, ' +
  '       s.dbId AS speciesID, ' +
  '       COLLECT(DISTINCT children.dbId) AS children, ' +
  '       COLLECT(DISTINCT parent.dbId) AS parents, ' +
  '       CASE WHEN re.variantIdentifier IS NULL THEN re.identifier ELSE re.variantIdentifier END AS identifier, ' +
  '       re.geneName AS geneNames';

/** getGraphEdges' query, joined as Java joins it. */
const EVENT_NODE_QUERY =
  '' +
  'MATCH (rle:ReactionLikeEvent {dbId:$dbId}) ' +
  'OPTIONAL MATCH (rle)-[:input]->(i:PhysicalEntity) ' +
  'OPTIONAL MATCH (rle)-[:output]->(o:PhysicalEntity) ' +
  'OPTIONAL MATCH (rle)-[:catalystActivity|physicalEntity*]->(c:PhysicalEntity) ' +
  'OPTIONAL MATCH (rle)-[:entityFunctionalStatus|diseaseEntity*]->(e:PhysicalEntity) ' +
  'OPTIONAL MATCH (rle)-[:regulatedBy]->(reg:Regulation)-[:regulator]->(r:PhysicalEntity) ' +
  'OPTIONAL MATCH prep=(p)-[:hasEvent*]->(pre:ReactionLikeEvent)<-[:precedingEvent]-(rle) ' +
  '  WHERE single(x IN nodes(prep) WHERE (x:Pathway AND coalesce(x.hasDiagram,false))) ' +
  'OPTIONAL MATCH folp=(p)-[:hasEvent*]->(fol:ReactionLikeEvent)-[:precedingEvent]->(rle) ' +
  '  WHERE single(x IN nodes(folp) WHERE (x:Pathway AND coalesce(x.hasDiagram,false))) ' +
  'WITH ' +
  '  rle.dbId AS dbId, ' +
  '  rle.stId AS stId, ' +
  '  rle.displayName AS displayName, ' +
  '  rle.schemaClass AS schemaClass, ' +
  '  collect(DISTINCT i.dbId) AS inputs, ' +
  '  collect(DISTINCT o.dbId) AS outputs, ' +
  '  collect(DISTINCT c.dbId) AS catalysts, ' +
  '  collect(DISTINCT e.dbId) AS efs, ' +
  '  collect(DISTINCT pre.dbId) AS preceding, ' +
  '  collect(DISTINCT fol.dbId) AS following, ' +
  '  collect(DISTINCT {type: reg.schemaClass, dbId: r.dbId}) AS regs ' +
  'RETURN ' +
  '  dbId, ' +
  '  stId, ' +
  '  displayName, ' +
  '  schemaClass, ' +
  '  inputs, ' +
  '  outputs, ' +
  '  catalysts, ' +
  '  efs, ' +
  '  CASE WHEN size(regs) = 0 THEN [] ELSE regs END AS regulations, ' +
  '  preceding, ' +
  '  following ';

/** EntityNodeImpl's fields. */
export interface EntityNode {
  parents: number[];
  children: number[];
  identifier: string | null;
  geneNames: (string | null)[];
  /** Null for an entity of the graph the layout does not draw. */
  diagramIds: number[] | null;
  dbId: number;
  stId: string | null;
  displayName: string | null;
  schemaClass: string | null;
  speciesID: number;
}

/** EventNodeImpl's fields. */
export interface EventNode {
  preceding: number[];
  following: number[];
  inputs: number[];
  outputs: number[];
  catalysts: number[];
  inhibitors: number[];
  activators: number[];
  requirements: number[];
  diagramIds: number[];
  efs: number[];
  dbId: number;
  stId: string | null;
  displayName: string | null;
  schemaClass: string | null;
  speciesId: number;
}

/** GraphImpl's fields. */
export interface ReactionGraph {
  dbId: number;
  stId: string;
  displayName: string;
  speciesName: string | null;
  nodes: EntityNode[];
  edges: [EventNode];
  /** A reaction has none: Java's new ArrayList. */
  subpathways: [];
}

type Row = Record<string, unknown>;

/** The driver's Uncoercible, which ReflectionUtils does not catch. */
const uncoercible = (to: string) => new JavaRuntimeException(`Cannot coerce value to ${to}`);

/** A String field: `asString(null)`. */
function text(row: Row, name: string): string | null {
  const value = row[name] ?? null;
  if (value === null || typeof value === 'string') return value;
  throw uncoercible('Java String');
}

/** A Long field: `asLong(0)`, so 0 where the row has none. */
function long(row: Row, name: string): number {
  const value = row[name] ?? null;
  if (value === null) return 0;
  if (typeof value === 'number' && Number.isInteger(value)) return value;
  throw uncoercible('Java long');
}

/** A List field: null or empty is an empty list. */
function list<T>(row: Row, name: string, element: (value: unknown) => T): T[] {
  const value = row[name] ?? null;
  if (value === null) return [];
  if (!Array.isArray(value)) throw uncoercible('Java List');
  return value.map(element);
}

const longElement = (value: unknown) => long({ value }, 'value');
// A String element is read as asString(null), as a field is: a null one is null.
const textElement = (value: unknown) => text({ value }, 'value');

/** One row of the entities' query, as ReflectionUtils fills an EntityNodeImpl. */
export function entityNode(row: Row): EntityNode {
  return {
    parents: list(row, 'parents', longElement),
    children: list(row, 'children', longElement),
    identifier: text(row, 'identifier'),
    geneNames: list(row, 'geneNames', textElement),
    diagramIds: list(row, 'diagramIds', longElement),
    dbId: long(row, 'dbId'),
    stId: text(row, 'stId'),
    displayName: text(row, 'displayName'),
    schemaClass: text(row, 'schemaClass'),
    speciesID: long(row, 'speciesID'),
  };
}

/** The event query's row, as ReflectionUtils fills an EventNodeImpl. */
export function eventNode(row: Row): EventNode {
  return {
    preceding: list(row, 'preceding', longElement),
    following: list(row, 'following', longElement),
    inputs: list(row, 'inputs', longElement),
    outputs: list(row, 'outputs', longElement),
    catalysts: list(row, 'catalysts', longElement),
    inhibitors: list(row, 'inhibitors', longElement),
    activators: list(row, 'activators', longElement),
    requirements: list(row, 'requirements', longElement),
    diagramIds: list(row, 'diagramIds', longElement),
    efs: list(row, 'efs', longElement),
    dbId: long(row, 'dbId'),
    stId: text(row, 'stId'),
    displayName: text(row, 'displayName'),
    schemaClass: text(row, 'schemaClass'),
    speciesId: long(row, 'speciesId'),
  };
}

/**
 * getMap: each drawn entity's dbId to the ids of the glyphs drawing it, in
 * the order the layout's entities iterate (a copy is a second glyph).
 */
export function diagramIdsByDbId(entities: Iterable<{ dbId: number; id: number }>) {
  const map = new JavaHashMap<number, number[]>({ hash: JavaHashMap.longHash });
  for (const entity of entities) map.computeIfAbsent(entity.dbId, () => []).push(entity.id);
  return map;
}

/** ReactionGraphFactory.getGraph: the graph of a laid-out reaction. */
export async function reactionGraph(layout: Laid): Promise<ReactionGraph> {
  const reaction = layout.reaction.data;
  const dbId = neo4j.int(reaction.dbId);
  const [entityRows, eventRows] = await Promise.all([
    read<Row>(ENTITY_NODES_QUERY, { dbId }),
    read<Row>(EVENT_NODE_QUERY, { dbId }),
  ]);
  const ids = diagramIdsByDbId(layout.entities);
  const nodes = entityRows.map(entityNode);
  for (const node of nodes) node.diagramIds = ids.get(node.dbId) ?? null;
  // getCustomQueryResult with no row is null, and setDiagramIds on it Java's NullPointerException.
  const [eventRow] = eventRows;
  if (!eventRow) throw new JavaNullPointerException();
  const edge = eventNode(eventRow);
  edge.diagramIds = [reaction.dbId];
  return {
    dbId: reaction.dbId,
    stId: reaction.stId,
    displayName: reaction.displayName,
    speciesName: reaction.speciesName ?? null,
    nodes,
    edges: [edge],
    subpathways: [],
  };
}
