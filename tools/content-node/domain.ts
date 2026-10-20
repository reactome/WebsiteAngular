/**
 * graph-core's domain objects, as the Java content service loads and writes
 * them: the object graph Spring Data Neo4j builds from a query's nodes and
 * relationships, and the JSON Jackson writes from it.
 *
 * Nothing about the model is restated here. Which properties each class writes,
 * in what order and in which view, and how each field maps onto the graph, are
 * read from the deployed libraries by snapshot-domain.ts into
 * domain-snapshot.json. What this file holds is the behaviour those libraries
 * have and a snapshot cannot carry: how SDN fills a field from relationships,
 * how Jackson writes a value, and the few getters that compute something
 * rather than return a field (COMPUTED, below).
 */
import { readFileSync } from 'node:fs';
import type { GraphNode, GraphRelationship } from './graph.ts';
import { schemaClassOf, supertypes } from './schema.ts';
import { JavaHashMap } from './java-hashmap.ts';

/** A JSON property Jackson writes: its name, what it reads, its views, 'D' for a double. */
export type SnapshotProperty = [name: string, source: string, views: number, double?: 'D'];
/** An SDN field: a property, or a relationship (RelationshipField). */
export type SnapshotField = [name: string, graphProperty: string] | RelationshipField;
/**
 * How a getter is answered: the field it reads, a computed getter by name,
 * the constant it returns, one taking arguments (refused), or one not ported.
 * 24 of the 286 entries are objects; 37 of the strings are a computed getter
 * or Object.getClass, so 61 are not a field (measured on the snapshot).
 */
export type GetterSource =
  string | { constant: string } | { arguments: number } | { unported: string };

/** A getter /data/query/{id}/{attribute} can reach. */
export type SnapshotGetter = [
  lowercaseName: string,
  getterName: string,
  source: GetterSource,
  returns: string,
  element: string,
  projected: string,
];

/** domain-snapshot.json as stored: every entry once, classes listing positions. */
export interface StoredSnapshot {
  properties: SnapshotProperty[];
  json: Record<string, number[]>;
  fields: SnapshotField[];
  graph: Record<string, { fields: number[]; defaults?: Record<string, unknown>; type?: string }>;
  getterEntries: SnapshotGetter[];
  getters: Record<string, number[]>;
  interfaces: string[];
  store: [schemaClass: string, labels: string[]][];
}

/** The snapshot expanded: each class with its own entries. */
interface DomainSnapshot {
  json: Record<string, SnapshotProperty[]>;
  graph: Record<
    string,
    { fields: SnapshotField[]; defaults?: Record<string, unknown>; type?: string }
  >;
  getters: Record<string, SnapshotGetter[]>;
  interfaces: Set<string>;
  store: StoredSnapshot['store'];
}

let snapshot: DomainSnapshot | undefined;
/** domain-snapshot.json, read on first use: snapshot-domain.ts imports this file to write it. */
function SNAPSHOT(): DomainSnapshot {
  if (snapshot) return snapshot;
  const stored = JSON.parse(
    readFileSync(new URL('./domain-snapshot.json', import.meta.url), 'utf8')
  ) as StoredSnapshot;
  // Stored interned (see snapshot-domain.ts); expanded once here.
  // Every position names an entry: the snapshot is written so.
  const at = <T>(list: T[], position: number): T => list[position] as T;
  const json: DomainSnapshot['json'] = {};
  for (const [name, positions] of Object.entries(stored.json))
    json[name] = positions.map((position) => at(stored.properties, position));
  const graph: DomainSnapshot['graph'] = {};
  for (const [name, entry] of Object.entries(stored.graph))
    graph[name] = { ...entry, fields: entry.fields.map((position) => at(stored.fields, position)) };
  const getters: DomainSnapshot['getters'] = {};
  for (const [name, positions] of Object.entries(stored.getters))
    getters[name] = positions.map((position) => at(stored.getterEntries, position));
  snapshot = { json, graph, getters, interfaces: new Set(stored.interfaces), store: stored.store };
  return snapshot;
}

/** StoichiometryView, as the bit each property's view mask uses. */
export const VIEW = { flatten: 1, nested: 2, nestedAggregated: 4 };

const PUBMED_URL = 'http://www.ncbi.nlm.nih.gov/pubmed/';

/** A node as SDN maps it: one instance per node, whatever reaches it. */
class Entity {
  // `declare` throughout: plain fields would define each one on every
  // instance before the constructor runs, a key where it sets none.
  declare id: number | string;
  declare schemaClass: string;
  declare properties: Record<string, unknown>;
  declare fields: Record<string, unknown>;
  constructor(id: number | string, schemaClass: string, properties: Record<string, unknown>) {
    this.id = id;
    this.schemaClass = schemaClass;
    this.properties = properties;
    this.fields = {};
  }
}

/** A relationship with properties (graph-core's Has subclasses): Input, HasComponent... */
class Relation {
  declare schemaClass: string;
  declare relationshipId: number | string | undefined;
  declare element: unknown;
  declare stoichiometry: number;
  declare order: number;
  /** Has.Default's only: set where given, absent otherwise. */
  declare type?: string;
  constructor(
    relationClass: string,
    element: unknown,
    properties: { stoichiometry?: number; order?: number },
    type?: string,
    relationshipId?: number | string
  ) {
    this.schemaClass = relationClass;
    this.relationshipId = relationshipId;
    this.element = element;
    this.stoichiometry = properties.stoichiometry ?? 1;
    this.order = properties.order ?? 0;
    // Has.Default carries its relationship's name; the others' is fixed.
    if (type !== undefined) this.type = type;
  }
}

/**
 * A Java Map written as a JSON object, its entries in the order given -- the
 * Map's own iteration order, which the caller decides (see JavaHashMap in
 * service.ts). Its values are written in one pass with everything else, so
 * `@id` numbering runs on across them as Jackson's does.
 */
export class JsonMap {
  declare entries: [string, unknown][];
  constructor(entries: [string, unknown][]) {
    this.entries = entries;
  }
}

/** Has.Util.wrapUniqueElements: a plain relationship as Has.Default, for composedOf. */
const wrap = (entities, type) =>
  (entities ?? []).map((entity) => new Relation('Default', entity, {}, type));

/**
 * CompositionAggregator.getComposedOf: the relationships each class composes
 * itself of (its defineCompositionRelations), concatenated in its order.
 */
function composedOf(entity) {
  const is = (name) => isA(entity.schemaClass, name);
  const fields = entity.fields;
  const all = (...lists) => lists.flatMap((list) => list ?? []);
  if (is('ReactionLikeEvent'))
    return all(
      fields.input,
      fields.output,
      wrap(fields.catalystActivity, 'catalyst'),
      wrap(fields.regulatedBy, 'regulation')
    );
  if (is('Complex')) return all(fields.hasComponent);
  if (is('CandidateSet')) return all(fields.hasMember, fields.hasCandidate);
  if (is('EntitySet')) return all(fields.hasMember);
  if (is('EntityWithAccessionedSequence')) return all(fields.hasModifiedResidue);
  if (is('Cell'))
    return all(wrap(fields.RNAMarker, 'rnaMarker'), wrap(fields.proteinMarker, 'proteinMarker'));
  if (is('Polymer')) return all(fields.repeatedUnit);
  // Pathway leaves hasEncapsulatedEvent out, as graph-core does (it loops).
  if (is('Pathway')) return all(fields.hasEvent);
  throw new Error(`domain: ${entity.schemaClass} is not a CompositionAggregator`);
}

/** Whether a class is, or descends from, another (Class.isAssignableFrom). */
export const isA = (schemaClass, target) => supertypes(schemaClass).has(target);

/**
 * A query result as the mapping reads it: the root, the nodes and
 * relationships returned beside it, and -- for findByIdQuery -- every related
 * node's id in the order SDN fills fields in.
 */
export interface MappedRow {
  root: GraphNode;
  nodes: GraphNode[];
  // A query that does not return a relationship's id gets one per record
  // (readRecord).
  relationships: (Omit<GraphRelationship, 'id'> & { id?: number | string })[];
  order?: (number | string)[];
}

/**
 * What SDN's mapping makes of one query result: the root and every node
 * returned beside it, each with its fields filled from the relationships
 * returned. A related node gets the fields that point back along those
 * relationships too -- a preceding event's `followingEvent` holds the root.
 *
 * `nodes` and `relationships` are in the order the query collected them, and
 * `order` -- every related node's id, kept or not (findByIdQuery) -- is the
 * one SDN fills fields in (see fill); without it, the nodes' own order.
 */
export function mapResult({ root, nodes, relationships: returned, order }: MappedRow) {
  const state = newState();
  readRecord(state, { root, nodes, relationships: returned, order });
  return map(state, root, undefined);
}

/**
 * What SDN's mapping makes of a query result of many records -- one object
 * per record, as Neo4jTemplate.findAll returns them -- read with one
 * converter, so with one KnownObjects: a node is one object across every
 * record, and an object met again in a later record has its relationships
 * filled again from that record (DefaultNeo4jEntityConverter.map, the
 * alreadyMappedInPreviousRecord branch; see refill in map). The relationships
 * a record names are counted across records as SDN counts them.
 */
export function mapResults(records) {
  const state = newState();
  return records.map((record) => {
    // KnownObjects.nextRecord: what is known so far is from a previous record.
    for (const id of state.current) state.previous.add(id);
    state.current.clear();
    readRecord(state, record);
    return map(state, record.root, undefined);
  });
}

/** One KnownObjects, for the records a mapping reads. */
function newState() {
  return {
    known: new Map(),
    relations: new Map(),
    processed: new Map(),
    previous: new Set(),
    current: new Set(),
  };
}

/** A record's nodes and relationships, as the mapping of it reads them. */
function readRecord(state, { root, nodes, relationships: returned, order }) {
  // extractRelationships / extractNodes: each relationship and node once, in
  // the order of first appearance -- the nodes of list columns first, then
  // single-node columns, so the root sits where it first appears in a list
  // and otherwise last.
  const seenRelationships = new Set();
  const relationships = returned
    // One without an id (a test's) is its own relationship, under a key of its own.
    .map((relationship, at) =>
      relationship.id === undefined ? { ...relationship, id: `#${at}` } : relationship
    )
    .filter(
      (relationship) =>
        !seenRelationships.has(relationship.id) && seenRelationships.add(relationship.id)
    );
  const listed = nodes.filter(Boolean);
  const byId = new Map();
  for (const node of [...listed, root]) if (!byId.has(node.id)) byId.set(node.id, node);
  const position = new Map();
  for (const id of [...(order ?? listed.map((node) => node.id)), root.id])
    if (!position.has(id)) position.set(id, position.size);
  Object.assign(state, { byId, position, relationships, removed: new Set(), byEnd: new Map() });
  for (const relationship of relationships) {
    for (const key of [
      `OUTGOING ${relationship.type} ${relationship.start}`,
      `INCOMING ${relationship.type} ${relationship.end}`,
    ]) {
      if (!state.byEnd.has(key)) state.byEnd.set(key, []);
      state.byEnd.get(key).push(relationship);
    }
  }
}

/**
 * DefaultNeo4jEntityConverter.map and createInstanceOfRelationships: the
 * root as an entity, and everything its fields reach.
 *
 * A node becomes an entity once, its class decided by the field that first
 * reaches it (classFor) -- so which field reaches a node first matters, and
 * SDN goes depth first: an entity met in a field has its own fields filled
 * before that field goes on to the next. Done here with a stack of frames, in
 * that order, rather than by recursion, which a deep in-depth answer -- an
 * object reached through thousands of others -- would run out of stack on.
 *
 * Each field: the candidates are the result's nodes that carry the target's
 * label, in result order; for each, the field's relationships to it, each
 * mapped as it is met. A relationship is counted per direction each time a
 * field uses it, and once one has been used twice in the same direction it
 * leaves the result for every field after -- SDN's guard against cycles,
 * kept for fidelity: on Reactome's model only PhysicalEntity has fields
 * sharing a type and direction (three `regulator` INCOMING), a node can match
 * at most two, and each owner is mapped once, so it does not fire. Not
 * reproduced: SDN gathers a list column's relationships into a HashSet, so two
 * parallel edges of one type between the same nodes would come in its hash
 * order, not the result's; whether the graph has any is unchecked. Filling node
 * by node rather than relationship by relationship is visible when one node
 * is reached twice: an entity that is both a reaction's input (order 2) and
 * its output (order 1) is the first output, because it was met among the
 * inputs; Java writes R-CEL-156804's reaction that way.
 */
/**
 * One object being filled, on map()'s stack: the relationship fields left
 * to fill, and while one is being filled, the rows that match it.
 */
interface Frame {
  entity: Entity;
  /** The snapshot's relationship fields: name, type, direction, target, collection, class. */
  fields: RelationshipField[];
  at: number;
  refill?: boolean;
  merging: boolean;
  matching:
    | {
        id: number | string;
        start: number | string;
        end: number | string;
        props: Record<string, unknown>;
      }[]
    | undefined;
  next: number;
  found: unknown[];
}

/** A relationship field as the snapshot holds it (snapshot-domain.ts). */
type RelationshipField = [
  name: string,
  type: string,
  direction: string,
  target: string,
  collection: string,
  relationClass: string | null,
];

function map(state, node, target) {
  const frames: Frame[] = [];
  const make = (from: GraphNode, to) => {
    const schemaClass = to ? classFor(to, from.labels) : schemaClassOf(from.labels);
    const entity = new Entity(from.id, schemaClass, from.props);
    // Known before its fields are filled, so a field leading back finds it.
    state.known.set(from.id, entity);
    state.current.add(from.id);
    const graph = SNAPSHOT().graph[schemaClass];
    if (graph) {
      for (const field of graph.fields)
        if (field.length === 2)
          entity.fields[field[0]] = entity.properties[field[1]] ?? graph.defaults?.[field[0]];
      frames.push({
        entity,
        fields: graph.fields.filter((field) => field.length > 2) as RelationshipField[],
        at: 0,
        merging: false,
        matching: undefined,
        next: 0,
        found: [],
      });
    }
    return entity;
  };
  // An object mapped in a previous record: its relationships filled again
  // from this one (populateProperties with objectAlreadyMapped).
  const refill = (entity) => {
    const graph = SNAPSHOT().graph[entity.schemaClass];
    if (graph)
      frames.push({
        entity,
        fields: graph.fields.filter((field) => field.length > 2) as RelationshipField[],
        at: 0,
        refill: true,
        merging: false,
        matching: undefined,
        next: 0,
        found: [],
      });
    return entity;
  };
  // DefaultNeo4jEntityConverter.map: a known object as it is, unless it is
  // from a previous record; a new one made.
  const reach = (from, to) => {
    const known = state.known.get(from.id);
    if (!known) return make(from, to);
    return state.previous.has(from.id) ? refill(known) : known;
  };
  const root = reach(node, target);
  while (frames.length) {
    const frame = frames[frames.length - 1];
    if (!frame) throw new Error('map: an empty frame stack while frames remain');
    if (!frame.matching) {
      if (frame.at === frame.fields.length) {
        frames.pop();
        continue;
      }
      const current = frame.fields[frame.at];
      // In range: the field count was checked just above.
      if (!current) throw new Error(`map: no field ${frame.at} on ${frame.entity.schemaClass}`);
      const [name, , , , collection] = current;
      const existing = frame.entity.fields[name];
      // A refilled object keeps a scalar it has; a collection it has is
      // merged with this record's (createInstanceOfRelationships without
      // fetching more); an empty one is filled as usual.
      frame.merging = false;
      if (frame.refill && existing !== undefined && existing !== null) {
        if (collection === '' || !Array.isArray(existing)) {
          frame.at += 1;
          continue;
        }
        if (existing.length) frame.merging = true;
      }
      frame.matching = matchingFor(state, frame.entity, current);
      frame.next = 0;
      frame.found = [];
    }
    const field = frame.fields[frame.at];
    const matching = frame.matching;
    // Both set just above, or on an earlier pass for this field.
    if (!field || !matching) throw new Error('map: a field being filled has no matches');
    const [name, , direction, target, collection, relationClass] = field;
    if (frame.next === matching.length) {
      frame.entity.fields[name] = frame.merging
        ? merged(frame.entity.fields[name], frame.found, collection, relationClass)
        : collect(frame.found, collection, relationClass);
      frame.matching = undefined;
      frame.at += 1;
      continue;
    }
    const relationship = matching[frame.next];
    if (!relationship) throw new Error('map: a match past the end of the matches');
    frame.next += 1;
    const key = `${direction} ${relationship.id}`;
    const used = state.processed.get(key) ?? 0;
    if (used === 2) state.removed.add(relationship.id);
    else state.processed.set(key, used + 1);
    const otherId = direction === 'OUTGOING' ? relationship.end : relationship.start;
    // A new entity pushes its frame: its fields are filled before this one goes on.
    let other;
    if (otherId === frame.entity.id) other = frame.entity;
    else if (frame.merging)
      other = state.known.get(otherId) ?? make(state.byId.get(otherId), target);
    else other = reach(state.byId.get(otherId), target);
    if (!relationClass) {
      frame.found.push(other);
      continue;
    }
    // A relationship's properties are one object too, across records.
    const relationKey = `${direction} ${relationship.id}`;
    let relation = state.relations.get(relationKey);
    if (!relation) {
      relation = new Relation(relationClass, other, relationship.props, undefined, relationship.id);
      state.relations.set(relationKey, relation);
    }
    frame.found.push(relation);
  }
  return root;
}

/**
 * A refilled object's collection: what it held and what this record adds,
 * gathered in a HashMap by id -- a relationship's own id, or the object's
 * dbId -- and put in a new collection of the same kind in that map's order
 * (DefaultNeo4jEntityConverter.mergeCollections).
 */
function merged(existing, provided, collection, relationClass) {
  const longHash = (id) => {
    const big = BigInt.asUintN(64, BigInt(id));
    return Number(BigInt.asIntN(32, big ^ (big >> 32n)));
  };
  // Keyed by relationship id or dbId, hashed as a Long.
  const map = new JavaHashMap<unknown, boolean>({ hash: longHash });
  const values = new Map();
  for (const item of [...existing, ...provided]) {
    const id = relationClass ? item.relationshipId : Number(item.properties.dbId);
    map.set(id, true);
    values.set(id, item);
  }
  return collect(
    [...map.keys()].map((id) => values.get(id)),
    collection,
    relationClass
  );
}

/** One field's relationships, in candidate order (see map). */
function matchingFor(state, entity: Entity, [, type, direction, target]: RelationshipField) {
  const outgoing = direction === 'OUTGOING';
  const otherEnd = (relationship) => (outgoing ? relationship.end : relationship.start);
  return (
    (state.byEnd.get(`${direction} ${type} ${entity.id}`) ?? [])
      .filter((relationship) => !state.removed.has(relationship.id))
      .filter((relationship) => state.byId.get(otherEnd(relationship))?.labels.includes(target))
      // Candidate order; stable, so relationships to one node keep theirs.
      .sort((a, b) => state.position.get(otherEnd(a)) - state.position.get(otherEnd(b)))
  );
}

/**
 * The class SDN instantiates for a node reached through a field typed
 * `target` (NodeDescriptionStore.computeConcreteNodeDescription).
 *
 * For a class, SDN searches the target's subclasses nearest first, so the
 * node's most specific label decides: schemaClassOf. For an interface --
 * UpdateTracker.updatedInstance is a Trackable, Deleted.replacementInstances
 * a Deletable -- it searches every class in its store's order and takes the
 * first whose labels include all the node's. A Pathway node can then be read
 * as a TopLevelPathway, which comes first: Java writes Apoptosis as a
 * TopLevelPathway inside its UpdateTracker and as a Pathway on its own.
 * Failing a full match, the class missing the fewest of its labels.
 */
function classFor(target, labels: string[]) {
  if (!SNAPSHOT().interfaces.has(target)) return schemaClassOf(labels);
  let best;
  let fewest = Infinity;
  for (const [name, staticLabels] of SNAPSHOT().store) {
    if (labels.every((label) => staticLabels.includes(label))) return name;
    const missing = staticLabels.filter((label) => !labels.includes(label)).length;
    if (missing < fewest) [best, fewest] = [name, missing];
  }
  return best ?? schemaClassOf(labels);
}

/** The field's collection as SDN creates it: ArrayList, LinkedHashSet, TreeSet. */
function collect(found, collection, relationClass) {
  // A single value is the first found (createInstanceOfRelationships: value.get(0)).
  if (collection === '') return found.length ? found[0] : undefined;
  if (collection === 'List') return found;
  // Has.equals compares elements; DatabaseObject.equals, the node.
  const key = relationClass ? (item) => item.element : (item) => item;
  if (collection === 'Set') {
    const seen = new Set();
    return found.filter((item) => !seen.has(key(item)) && seen.add(key(item)));
  }
  // A TreeSet: Has compares by order, DatabaseObject by dbId; equal ones are dropped.
  const rank = relationClass ? (item) => item.order : (item) => Number(item.properties['dbId']);
  const sorted: unknown[] = [];
  for (const item of found) {
    if (sorted.some((kept) => rank(kept) === rank(item))) continue;
    sorted.push(item);
  }
  return sorted.sort((a, b) => rank(a) - rank(b));
}

/** Has.Util.expandStoichiometry: each element as many times as its stoichiometry. */
function expand(relations) {
  if (relations === undefined || relations === null) return undefined;
  return relations.flatMap((relation) => Array(relation.stoichiometry).fill(relation.element));
}

const expanding = (field) => (entity) => expand(entity.fields[field]);
const constant = (value) => () => value;

/**
 * The getters that compute their value, by declaring class and method. Every
 * other getter Jackson calls returns its field (snapshot-domain.ts checks the
 * bytecode for that, and fails on a getter that is in neither group).
 */
const COMPUTED = {
  'DatabaseObject.getClassName': (entity) => entity.schemaClass,
  'DatabaseObject.getSchemaClass': (entity) => entity.schemaClass,
  'EntitySet.getClassName': constant('Set'),
  'GenomeEncodedEntity.getClassName': constant('Genes and Transcripts'),
  'ReactionLikeEvent.getClassName': constant('Reaction'),
  'SimpleEntity.getClassName': constant('Chemical Compound'),
  // Otherwise super.getClassName(): GenomeEncodedEntity's.
  'EntityWithAccessionedSequence.getClassName': (entity) =>
    ({
      ReferenceGeneProduct: 'Protein',
      ReferenceDNASequence: 'DNA Sequence',
      ReferenceRNASequence: 'RNA Sequence',
    })[entity.fields.referenceType] ?? 'Genes and Transcripts',
  'CandidateSet.getHasCandidate': expanding('hasCandidate'),
  'Complex.getHasComponent': expanding('hasComponent'),
  'Complex.getIncludedLocation': expanding('includedLocation'),
  'EntitySet.getHasMember': expanding('hasMember'),
  'EntityWithAccessionedSequence.getHasModifiedResidue': expanding('hasModifiedResidue'),
  'Event.getCompartment': expanding('compartment'),
  'Event.getEventOf': expanding('eventOf'),
  'Pathway.getHasEvent': expanding('hasEvent'),
  'Pathway.getHasEncapsulatedEvent': expanding('hasEncapsulatedEvent'),
  // super.getCreated() / getModified(): DatabaseObject's field.
  'Person.getCreated': (entity) => entity.fields.created,
  'Person.getModified': (entity) => entity.fields.modified,
  // databaseName.replace(" ", "-"); no database name is Java's NullPointerException.
  'ReferenceEntity.getSimplifiedDatabaseName': (entity) => {
    if (entity.fields.databaseName === undefined || entity.fields.databaseName === null)
      throw new AttributeFailure('null', 'ReferenceEntity.getSimplifiedDatabaseName');
    return entity.fields.databaseName.replaceAll(' ', '-');
  },
  'PhysicalEntity.getCandidateOf': expanding('candidateOf'),
  'PhysicalEntity.getCompartment': expanding('compartment'),
  'PhysicalEntity.getComponentOf': expanding('componentOf'),
  'PhysicalEntity.getConsumedByEvent': expanding('consumedByEvent'),
  'PhysicalEntity.getMemberOf': expanding('memberOf'),
  'PhysicalEntity.getProducedByEvent': expanding('producedByEvent'),
  'PhysicalEntity.getRepeatedUnitOf': expanding('repeatedUnitOf'),
  'Polymer.getRepeatedUnit': expanding('repeatedUnit'),
  'Publication.getAuthor': expanding('author'),
  'ReactionLikeEvent.getDiseaseReaction': expanding('diseaseReactions'),
  'ReactionLikeEvent.getInput': expanding('input'),
  'ReactionLikeEvent.getOutput': expanding('output'),
  'PhysicalEntity.getMarkingReferences': (entity) => entity.fields.markingReferences,
  'Person.getPublications': (entity) =>
    entity.fields.publicationAuthorList?.map((relation) => relation.element),
  'LiteratureReference.getUrl': (entity) =>
    entity.fields.pubMedIdentifier === undefined || entity.fields.pubMedIdentifier === null
      ? undefined
      : PUBMED_URL + entity.fields.pubMedIdentifier,
  'DBInfo.getVersion': (entity) => entity.fields.releaseNumber,
  'AuthorPublication.getPublication': (relation) => relation.element,
  'Has.getOrder': (relation) => relation.order,
  'Has.getStoichiometry': (relation) => relation.stoichiometry,
  'Has.getElement': (relation) => relation.element,
  'CompositionAggregator.getComposedOf': composedOf,
  // The content service's SummaryEntity (summaryEntity, below).
  'SummaryEntity.getHasModifiedResidue': expanding('hasModifiedResidue'),
  // Otherwise super.getClassName(): DatabaseObject's, the class's own name.
  'SummaryEntity.getClassName': (entity) =>
    ({
      ReferenceGeneProduct: 'Protein',
      ReferenceDNASequence: 'DNA Sequence',
      ReferenceRNASequence: 'RNA Sequence',
    })[entity.fields.referenceType] ?? 'SummaryEntity',
};

/** The computed getters, by name, for snapshot-domain.ts to check against graph-core. */
export const COMPUTED_GETTERS = Object.keys(COMPUTED);

/**
 * The value Jackson gets from a property's getter: the field it returns, or
 * what a computed getter works out. A relationship class's getType() is the
 * constant the snapshot recorded.
 */
function valueOf(target, source) {
  if (!source.includes('.'))
    return target instanceof Relation ? target[source] : target.fields[source];
  const computed = COMPUTED[source];
  if (computed) return computed(target);
  return SNAPSHOT().graph[target.schemaClass]?.type;
}

/** JsonInclude.NON_EMPTY: no null, no empty string, no empty collection. */
const empty = (value) =>
  value === undefined || value === null || value === '' || (Array.isArray(value) && !value.length);

/**
 * Jackson's output for an object graph, in a view.
 *
 * Every DatabaseObject carries @JsonIdentityInfo on dbId: the first time an
 * entity is written it is written whole, and every time after that as its
 * dbId alone. With `jsog` (Java's `?includeRef=true`) the identity is
 * JSOGGenerator's instead: each entity's first appearance starts with
 * "@id":"n", counting from 1, and later ones are {"@ref":"n"}. Relations
 * (Has) carry no identity and are written whole each time.
 *
 * Property order is the snapshot's, which is Jackson's: field-backed
 * properties in declaration order, then the getter-only ones (className,
 * schemaClass, inputs, outputs...) in the order the JVM lists the class's
 * methods. The JVM does not promise that order, and does not keep it: three
 * runs of one JDK gave two orders for Reaction's `hasCompartment` and
 * `eventOfPathways`, and Java's live answers put `outputs` before `inputs` in
 * the nested view while the snapshot has them the other way. So in the nested
 * views a few keys can sit elsewhere than Java's answer of the day -- the same
 * data, and the same thing a Tomcat restart does -- and under JSOG the numbers
 * follow. Seen happen: before a Tomcat restart on 15 Oct 2026 Java wrote an
 * EntityWithAccessionedSequence's componentOfComplexes before candidateOfSet,
 * after it the other way. So the nested views are compared with Java as data;
 * the default (flatten) view, which matched Java byte for byte over 20,279
 * objects of every class, did so before that restart and after it.
 */
/** What writeDomain has still to write: text as it is, or a value to write. */
type WorkItem = string | { value: unknown; floating: boolean };

export function writeDomain(value: unknown, view = VIEW.flatten, { jsog = false } = {}): string {
  // Iterative, not recursive: an in-depth answer nests thousands of objects
  // deep, which overflowed the stack, and building each level's text to hand
  // to the level above copied the same bytes once per level. Pieces go into
  // one array, joined once. Work is a stack of what is still to be written,
  // in reverse; an object is opened -- and, being an entity, marked written
  // -- when it is taken off, so references fall exactly where they did when
  // this recursed.
  const out: string[] = [];
  const seen = new Map<Entity, number>();
  const work: WorkItem[] = [{ value, floating: false }];
  while (work.length) {
    const item = work.pop();
    if (item === undefined) throw new Error('writeDomain: an empty work stack while work remains');
    if (typeof item === 'string') {
      out.push(item);
      continue;
    }
    const { value: current, floating } = item;
    if (current instanceof Entity) {
      if (seen.has(current)) {
        out.push(jsog ? `{"@ref":"${seen.get(current)}"}` : number(current.fields['dbId']));
        continue;
      }
      seen.set(current, seen.size + 1);
      open(out, work, current, view, jsog ? `"@id":"${seen.size}"` : undefined);
    } else if (current instanceof Relation) {
      open(out, work, current, view);
    } else if (current instanceof JsonMap) {
      out.push('{');
      work.push('}');
      for (let at = current.entries.length - 1; at >= 0; at -= 1) {
        const pair = current.entries[at];
        if (!pair) throw new Error(`writeDomain: a JsonMap with a hole at ${at}`);
        const [key, entry] = pair;
        work.push({ value: entry, floating });
        work.push(`${javaString(key)}:`);
        if (at > 0) work.push(',');
      }
    } else if (Array.isArray(current)) {
      out.push('[');
      work.push(']');
      for (let at = current.length - 1; at >= 0; at -= 1) {
        work.push({ value: current[at], floating });
        if (at > 0) work.push(',');
      }
    } else {
      out.push(scalar(current, floating));
    }
  }
  return out.join('');
}

/** An object's opening, and its members queued in order (reversed onto the stack). */
function open(
  out: string[],
  work: WorkItem[],
  target: Entity | Relation,
  view: number,
  first?: string
): void {
  const members: [string, unknown, boolean][] = [];
  for (const [name, source, views, floating] of SNAPSHOT().json[target.schemaClass] ?? []) {
    if (!(views & view)) continue;
    const value = valueOf(target, source);
    if (empty(value)) continue;
    members.push([name, value, floating === 'D']);
  }
  out.push('{');
  if (first) out.push(first, members.length ? ',' : '');
  work.push('}');
  for (let at = members.length - 1; at >= 0; at -= 1) {
    const member = members[at];
    if (!member) throw new Error(`open: a member hole at ${at}`);
    const [name, value, floating] = member;
    work.push({ value, floating });
    work.push(`${javaString(name)}:`);
    if (at > 0) work.push(',');
  }
}

function scalar(value, floating) {
  if (typeof value === 'string') return javaString(value);
  if (typeof value === 'boolean') return String(value);
  if (typeof value === 'number') return floating ? javaDouble(value) : number(value);
  if (typeof value === 'bigint') return String(value);
  throw new Error(`domain: cannot write ${typeof value}`);
}

/** A whole number as Java writes a Long; graph.ts hands an unsafe one over as text. */
function number(value) {
  return String(value);
}

/** A string as Jackson escapes it: as JSON.stringify, with upper-case \u00XX. */
function javaString(text) {
  return JSON.stringify(text).replace(/(\\+)u00([0-9a-f]{2})/g, (match, slashes, hex) =>
    slashes.length % 2 ? `${slashes}u00${hex.toUpperCase()}` : match
  );
}

/**
 * Double.toString: always a decimal point; scientific notation, as `1.0E-4`,
 * below 10^-3 and from 10^7.
 */
export function javaDouble(value) {
  if (!Number.isFinite(value)) return JSON.stringify(String(value));
  const magnitude = Math.abs(value);
  if (magnitude !== 0 && (magnitude < 1e-3 || magnitude >= 1e7)) {
    const [mantissa, exponent] = value.toExponential().split('e');
    return `${mantissa.includes('.') ? mantissa : `${mantissa}.0`}E${Number(exponent)}`;
  }
  const text = String(value);
  return text.includes('.') ? text : `${text}.0`;
}

/**
 * graph-core's AdvancedDatabaseObjectRepository.findById(id, OUTGOING), with
 * its RETURN taken apart so the driver's nodes and relationships can be mapped
 * here. The order is Java's: by relationship type, then by its `order`.
 *
 * `anchor`, `ordered` and `without` give graph-core's other forms of the same
 * query: findPersonByDbId matches a Person, leaves InstanceEdits out and has
 * no ORDER BY, so its relationships come in the graph's own order.
 *
 * Java loads every related node; most of a curator's are the InstanceEdits
 * they authored -- 16,900 for one person -- which no Person field can hold.
 * Only nodes some field of the root's class can hold come back whole (`keep`,
 * from findByIdParameters, which needs the root's labels first:
 * rootLabelsQuery), with every relationship that reaches them. Every
 * related node's id still comes back, in order, because a node's first
 * appearance decides where it sits in a list (fill). For that person: 1.6s
 * with all of them, ~100ms without.
 */
export function findByIdQuery(
  where,
  {
    anchor = 'n:DatabaseObject',
    ordered = true,
    without,
  }: { anchor?: string; ordered?: boolean; without?: string } = {}
) {
  return `MATCH (${anchor}) WHERE ${where}
     OPTIONAL MATCH (n)-[r]->(m) ${without ? `WHERE NOT m:${without}` : ''}
     ${ordered ? 'WITH n, r, m ORDER BY TYPE(r) ASC, r.order ASC' : ''}
     WITH n, COLLECT(r) AS rs, COLLECT(m) AS ms
     WITH n, rs, ms, [r IN rs WHERE any(target IN coalesce($keep[type(r)], [])
                        WHERE target IN labels(endNode(r))) | id(endNode(r))] AS kept
     RETURN {id: id(n), labels: labels(n), props: properties(n)} AS root,
            [m IN ms | id(m)] AS order,
            [m IN ms WHERE id(m) IN kept | {id: id(m), labels: labels(m), props: properties(m)}] AS nodes,
            [r IN rs WHERE id(endNode(r)) IN kept | {type: type(r), start: id(startNode(r)),
                        end: id(endNode(r)), props: properties(r)}] AS relationships`;
}

/** The labels of the object findByIdQuery will load, to pick its parameters by. */
export function rootLabelsQuery(where, { anchor = 'n:DatabaseObject' } = {}) {
  return `MATCH (${anchor}) WHERE ${where} RETURN labels(n) AS labels LIMIT 1`;
}

/**
 * graph-core's getPhysicalEntityInDepth / getEventInDepth: the root, every
 * path below it along `follow` up to `maxDepth` steps, and from each node on a
 * path its `attributes` relationships -- as Java's MATCH, so a root with no
 * such path is no result at all. `attributes` must already be checked to be
 * relationship type names (inDepthAttributes); Java writes it into the query
 * text as it comes, and so does this, which is why it is checked.
 *
 * Java collects a list per path per node on it, the same nodes over and over:
 * 254,598 occurrences of 1,800 nodes for one set at full depth, 87MB written
 * out whole, which took node minutes to read and stalled every other request
 * meanwhile. Each node and relationship comes back once instead, in the order
 * of its first appearance -- the only order the mapping uses (mapResult).
 */
export function inDepthQuery({ label, follow, idType, maxDepth, attributes }) {
  const node = (n) => `{id: id(${n}), labels: labels(${n}), props: properties(${n})}`;
  const rel = (r) =>
    `{id: id(${r}), type: type(${r}), start: id(startNode(${r})), end: id(endNode(${r})), props: properties(${r})}`;
  return `MATCH (root:DatabaseObject) WHERE root.${idType} = ${idType === 'dbId' ? 'toInteger($id)' : '$id'} AND root:${label}
     MATCH path=(root)-[:${follow}*1..${maxDepth}]->(:${label})
     WITH root, nodes(path) AS nodesPath, relationships(path) AS rels
     UNWIND nodesPath AS nodePath
     OPTIONAL MATCH p2=(nodePath)-[:${attributes}]->(attributes)
     WITH root, collect(nodesPath) + collect(nodes(p2)) AS nodeLists,
          collect(rels) + collect(relationships(p2)) AS relationshipLists
     CALL {
       WITH nodeLists
       UNWIND nodeLists AS list UNWIND list AS n
       RETURN collect(DISTINCT n) AS nodes
     }
     CALL {
       WITH relationshipLists
       UNWIND relationshipLists AS list UNWIND list AS r
       RETURN collect(DISTINCT r) AS relationships
     }
     RETURN ${node('root')} AS root,
            [n IN nodes | ${node('n')}] AS nodes,
            [r IN relationships | ${rel('r')}] AS relationships`;
}

/**
 * graph-core's findOldEnhancedObjectById: the object, everything it is
 * related to (outgoing only, or both ways), those objects' species, and their
 * regulations, physical entities, references and markers one step further.
 *
 * Java collects every row's nodes, repeats and all, which for a busy object
 * is the same nodes many times over. Only the order of first appearance
 * matters to the mapping (fill), and collecting each list DISTINCT keeps that
 * order: a node first appears where it first appears in its first list.
 */
export function oldEnhancedQuery({ idType, outgoingOnly }) {
  const node = (n) => `{id: id(${n}), labels: labels(${n}), props: properties(${n})}`;
  const rel = (r) =>
    `{id: id(${r}), type: type(${r}), start: id(startNode(${r})), end: id(endNode(${r})), props: properties(${r})}`;
  return `MATCH (n:DatabaseObject) WHERE n.${idType} = ${idType === 'dbId' ? 'toInteger($id)' : '$id'}
     OPTIONAL MATCH (n)-[r1]-${outgoingOnly ? '>' : ''}(m)
     OPTIONAL MATCH (m)-[r2:species]->(s)
     OPTIONAL MATCH (m)-[r3:regulator|regulatedBy|physicalEntity|crossReference|referenceGene|literatureReference|marker]-(o)
     WITH n, collect(DISTINCT m) AS ms, collect(DISTINCT s) AS ss, collect(DISTINCT o) AS os,
          collect(DISTINCT r1) + collect(DISTINCT r2) + collect(DISTINCT r3) AS rs
     RETURN ${node('n')} AS root, [x IN ms + ss + os | ${node('x')}] AS nodes,
            [r IN rs | ${rel('r')}] AS relationships`;
}

/**
 * graph-core's findEnhancedObjectById (/query/enhanced/v2), as its
 * AdvancedDatabaseObjectRepository writes it: the object -- or, summarising
 * a reference entity, the object and every physical entity referring to it --
 * with everything related to each (outgoing only, or both ways), their
 * species, reference entities, authors, compartments, regulations and the
 * rest one step further. UpdateTrackers are left out; so, unless
 * `includeDisease`, is anything in disease. Java's text, with its RETURN
 * taken apart as findByIdQuery's is.
 */
export function enhancedQuery({ idType, summarise, includeDisease, outgoingOnly }) {
  const node = (n) => `{id: id(${n}), labels: labels(${n}), props: properties(${n})}`;
  const rel = (r) =>
    `{id: id(${r}), type: type(${r}), start: id(startNode(${r})), end: id(endNode(${r})), props: properties(${r})}`;
  const expand = !summarise
    ? 'WITH root, root AS n '
    : `OPTIONAL MATCH (root:ReferenceEntity)<-[:referenceEntity]-(pe:PhysicalEntity${includeDisease ? '' : ' {isInDisease: false}'})
       WITH collect(pe) + root AS ns, root
       UNWIND ns AS n `;
  const filter = includeDisease
    ? 'WHERE NOT m:UpdateTracker '
    : 'WHERE (m.isInDisease IS NULL OR m.isInDisease = false) AND NOT m:UpdateTracker ';
  return `MATCH (root:DatabaseObject) WHERE root.${idType} = ${idType === 'dbId' ? 'toInteger($id)' : '$id'}
     ${expand}
     OPTIONAL MATCH (n)-[r1]-${outgoingOnly ? '>' : ''}(m:DatabaseObject)
     ${filter}
     OPTIONAL MATCH (m)-[r2:species]->(s)
     OPTIONAL MATCH (m)-[r9:referenceEntity]->(rf:ReferenceEntity)
     OPTIONAL MATCH (m:Publication)<-[r5:author]-(p2:Person)
     OPTIONAL MATCH (m:InstanceEdit)<-[r6:author]-(p3:Person)
     OPTIONAL MATCH (m:Event)-[r7:compartment]->(c:Compartment)
     OPTIONAL MATCH (m)-[r3:regulator|regulatedBy|physicalEntity|crossReference|referenceGene|
                        referenceTranscript|literatureReference|marker|regulation|
                        catalystActivity|activeUnit|activity|psiMod|modification|
                        goBiologicalProcess]-(o)
     OPTIONAL MATCH (o:Publication)<-[r4:author]-(p:Person)
     OPTIONAL MATCH (o)-[r8:species]->(s1:Species)
     WITH root,
          collect(DISTINCT n) AS ns, collect(DISTINCT m) AS ms, collect(DISTINCT s) AS ss,
          collect(DISTINCT o) AS os, collect(DISTINCT p) AS ps, collect(DISTINCT p2) AS ps2,
          collect(DISTINCT p3) AS ps3, collect(DISTINCT c) AS cs, collect(DISTINCT s1) AS s1s,
          collect(DISTINCT rf) AS rfs,
          collect(DISTINCT r1) AS r1s, collect(DISTINCT r2) AS r2s, collect(DISTINCT r3) AS r3s,
          collect(DISTINCT r4) AS r4s, collect(DISTINCT r5) AS r5s, collect(DISTINCT r6) AS r6s,
          collect(DISTINCT r7) AS r7s, collect(DISTINCT r8) AS r8s, collect(DISTINCT r9) AS r9s
     RETURN ${node('root')} AS root,
            [x IN ns + ms + ss + os + ps + ps2 + ps3 + cs + s1s + rfs | ${node('x')}] AS nodes,
            [r IN r1s + r2s + r3s + r4s + r5s + r6s + r7s + r8s + r9s | ${rel('r')}] AS relationships`;
}

/**
 * The content service's SummaryEntity: a reference entity written as one
 * physical entity standing for all that refer to it, which /query/enhanced/v2
 * answers with when asked to summarise. Its constructor, in its order:
 *
 * - the reference entity's identity, names, database, links and cross
 *   references; a sequence's genes, checksum, comments, keywords, length and
 *   species; a gene product's chains, genes and transcripts; an isoform's
 *   variant and parent;
 * - the physical entities, sorted -- in the reference entity's own list too,
 *   which is sorted in place -- by their modified residues (none for all but
 *   an EWAS), then dbId, as `summarisedEntities`;
 * - then, entity by entity, each property merged in: a list joined to what
 *   is there already, each element once (LinkedHashSet), through the
 *   SummaryEntity's own getter and PhysicalEntity's setter -- which for the
 *   stoichiometric ones (compartment, componentOf, memberOf, candidateOf)
 *   expands and re-aggregates; a single value (species, referenceType)
 *   replaced by the entity's if it has one.
 */
export function summaryEntity(reference) {
  const summary = new Entity(reference.id, 'SummaryEntity', {});
  const from = reference.fields;
  const to = summary.fields;
  const copy = (...names) => {
    for (const name of names) to[name] = from[name];
  };
  copy('dbId', 'stId', 'displayName', 'name');
  to['referenceEntity'] = reference;
  copy(
    'moleculeType',
    'databaseName',
    'identifier',
    'url',
    'referenceDatabase',
    'otherIdentifier',
    'crossReference'
  );
  const is = (name) => isA(reference.schemaClass, name);
  if (is('ReferenceSequence'))
    copy(
      'geneName',
      'secondaryIdentifier',
      'checksum',
      'comment',
      'description',
      'keyword',
      'sequenceLength',
      'species',
      'isSequenceChanged'
    );
  if (is('ReferenceGeneProduct')) copy('chain', 'referenceGene', 'referenceTranscript');
  if (is('ReferenceIsoform')) copy('variantIdentifier', 'isoformParent');

  const residues = (entity) =>
    isA(entity.schemaClass, 'EntityWithAccessionedSequence')
      ? (entity.fields.hasModifiedResidue ?? []).length
      : 0;
  const entities = from.physicalEntity ?? [];
  entities.sort(
    (a, b) => residues(a) - residues(b) || Number(a.fields.dbId) - Number(b.fields.dbId)
  );
  to['summarisedEntities'] = entities;

  const union = (existing, added) => [...new Set([...(existing ?? []), ...added])];
  const unionRelations = (existing, added) => {
    const out = [...(existing ?? [])];
    for (const relation of added)
      if (!out.some((kept) => kept.element === relation.element)) out.push(relation);
    return out;
  };
  // PhysicalEntity's setter for a stoichiometric list: one relation per element,
  // in the order given (Has.Util.aggregateStoichiometry).
  const aggregate = (elements, relationClass) =>
    elements.map(
      (element, order) => new Relation(relationClass, element, { order, stoichiometry: 1 })
    );
  const plain = [
    'disease',
    'crossReference',
    'isRequired',
    'inferredFrom',
    'inferredTo',
    'catalystActivities',
    'literatureReference',
    'positivelyRegulates',
    'negativelyRegulates',
    'markingReferences',
  ];
  const stoichiometric = {
    compartment: 'HasCompartment',
    componentOf: 'ComponentOf',
    memberOf: 'MemberOf',
    candidateOf: 'CandidateOf',
  };
  // In the accessors' order (SummaryEntity.accessors).
  const order = [
    'disease',
    'crossReference',
    'compartment',
    'componentOf',
    'memberOf',
    'candidateOf',
    'isRequired',
    'inferredFrom',
    'inferredTo',
    'consumedByEvent',
    'producedByEvent',
    'catalystActivities',
    'literatureReference',
    'positivelyRegulates',
    'negativelyRegulates',
    'markingReferences',
  ];
  for (const entity of entities) {
    for (const name of order) {
      if (plain.includes(name)) {
        const value = entity.fields[name];
        if (!value?.length) continue;
        to[name] = union(to[name], value);
      } else if (name in stoichiometric) {
        const value = expand(entity.fields[name]);
        if (!value?.length) continue;
        to[name] = aggregate(union(expand(to[name]), value), stoichiometric[name]);
      } else {
        // inputFor / outputFor: the relations themselves, one per element.
        const value = entity.fields[name];
        if (!value?.length) continue;
        to[name] = unionRelations(to[name], value);
      }
    }
    if (isA(entity.schemaClass, 'GenomeEncodedEntity') || isA(entity.schemaClass, 'SimpleEntity')) {
      if (entity.fields.species !== undefined && entity.fields.species !== null)
        to['species'] = entity.fields.species;
    }
    if (
      isA(entity.schemaClass, 'SimpleEntity') ||
      isA(entity.schemaClass, 'EntityWithAccessionedSequence')
    ) {
      if (entity.fields.referenceType !== undefined && entity.fields.referenceType !== null)
        to['referenceType'] = entity.fields.referenceType;
    }
  }
  return summary;
}

/**
 * Nodes on their own, as SDN maps a query that returns only nodes: each with
 * its properties and no relationships, one instance per node, so a node that
 * comes back twice is the same object -- and written the second time as its
 * dbId.
 */
export function mapNodes(nodes: GraphNode[]) {
  const mapped = new Map();
  return nodes.map((node) => {
    if (!mapped.has(node.id))
      mapped.set(node.id, mapResult({ root: node, nodes: [], relationships: [] }));
    return mapped.get(node.id);
  });
}

/**
 * findByIdQuery's `$keep`, for an object with these labels: for each
 * relationship type one of its class's outgoing fields has, the target
 * classes. A related node is kept when it carries one of their labels --
 * classes and the interfaces SDN maps are labels on the nodes, inherited
 * ones included.
 */
export function findByIdParameters(labels: string[]) {
  const keep: Record<string, string[]> = {};
  for (const field of SNAPSHOT().graph[schemaClassOf(labels)]?.fields ?? []) {
    // A property field has no direction; only relationships go on.
    if (field.length !== 6) continue;
    const [, type, direction, target] = field;
    if (direction !== 'OUTGOING') continue;
    const targets = (keep[type] ??= []);
    if (!targets.includes(target)) targets.push(target);
  }
  return { keep };
}

/*
 * /data/query/{id}/{attributeName}: an object's getter called by name, as
 * ControllerUtils.getProperty calls it, and its value written as toTSV
 * writes it. The getters are graph-core's own, each class's read from the
 * deployed jar into the snapshot (`getters`) with what each returns: a field,
 * a getter COMPUTED here, a constant, Object.getClass.
 */

/**
 * The getter getProperty finds for an attribute: the first public method
 * whose name is "get" + the attribute, ignoring case. No two of a class's
 * getters differ only in case, so that is at most one, whatever order the
 * JVM lists them in. Undefined when there is none.
 */
export function attributeGetter(schemaClass, attribute) {
  const wanted = `get${attribute}`.toLowerCase();
  const entry = SNAPSHOT().getters[schemaClass]?.find(([lower]) => lower === wanted);
  if (!entry) return undefined;
  const [, name, source, returns, element, projected] = entry;
  return { name, source, returns, element, projected };
}

/** A getter that cannot be answered: one taking arguments, or one not ported. */
export class AttributeFailure extends Error {
  declare kind: string;
  declare detail: string;
  constructor(kind: string, detail: string) {
    super(`${kind}: ${detail}`);
    this.kind = kind;
    this.detail = detail;
  }
}

/** What a getter returns, from the fields as they now stand. */
function getterResult(entity, getter) {
  const { source } = getter;
  if (typeof source === 'string') {
    if (source === 'Object.getClass')
      return { javaClass: `class org.reactome.server.graph.domain.model.${entity.schemaClass}` };
    if (COMPUTED[source]) return COMPUTED[source](entity);
    return entity.fields[source];
  }
  if (Object.hasOwn(source, 'constant')) return source.constant;
  if (Object.hasOwn(source, 'arguments')) throw new AttributeFailure('arguments', source.arguments);
  throw new AttributeFailure('unported', source.unported);
}

const COLLECTIONS = new Set(['List', 'Set', 'SortedSet', 'Collection']);
const isEmptyResult = (value) =>
  value === undefined || value === null || (Array.isArray(value) && value.length === 0);

/**
 * Has.Util.aggregateStoichiometry, as a relationship field's setter applies
 * it to what the aspect loaded: one relationship per object, in the order
 * first met (its `order` counting from 0), its stoichiometry the times met.
 */
function aggregate(relationClass, entities) {
  const byId = new Map();
  for (const entity of entities) {
    const key = entity.properties.dbId;
    const relation = byId.get(key);
    if (relation) relation.stoichiometry += 1;
    else byId.set(key, new Relation(relationClass, entity, { order: byId.size, stoichiometry: 1 }));
  }
  return [...byId.values()];
}

/**
 * The getter's value, as LazyFetchAspect leaves it. autoFetch: a getter that
 * returns DatabaseObjects, named after a relationship field, whose value is
 * empty, loads the relationship (lazyLoad) and sets it through the field's
 * setter, then is called again. Java fetches an empty outgoing relationship
 * again too -- its `isLoaded && OUTGOING` guard compares the annotation with
 * the Direction enum, which is never equal -- but findById already loaded
 * every outgoing relationship, unfiltered, so that fetch finds nothing more
 * and is skipped here; only incoming ones are fetched -- unless the object
 * came from a query that did not load them (`outgoingLoaded` false).
 * aroundReactomeProjectedRelationship: a getter whose value is empty first
 * calls the getter it names, then is called again.
 */
export async function attributeValue(entity, getter, lazyLoad, { outgoingLoaded = true } = {}) {
  let value = getterResult(entity, getter);
  if (getter.projected && isEmptyResult(value)) {
    const named = attributeGetter(entity.schemaClass, getter.projected.slice(3));
    if (named) await attributeValue(entity, named, lazyLoad, { outgoingLoaded });
    value = getterResult(entity, getter);
  }
  if (!isEmptyResult(value)) return value;
  const fieldName = getter.name.charAt(3).toLowerCase() + getter.name.slice(4);
  const field = SNAPSHOT().graph[entity.schemaClass]?.fields.find(
    (spec) => spec[0] === fieldName && spec.length > 2
  );
  if (!field) return value;
  const [, type, direction, , collection, relationClass] = field;
  const returnsObjects = COLLECTIONS.has(getter.returns)
    ? getter.element !== '' && isDomainObject(getter.element)
    : isDomainObject(getter.returns);
  if (!returnsObjects || (direction !== 'INCOMING' && outgoingLoaded)) return value;
  const loaded = await lazyLoad(entity.properties.dbId, type, direction, getter, collection);
  if (relationClass) entity.fields[fieldName] = aggregate(relationClass, loaded);
  else if (collection === '') entity.fields[fieldName] = loaded[0];
  else entity.fields[fieldName] = loaded;
  return getterResult(entity, getter);
}

/** Whether a class is a DatabaseObject, as the aspect's pointcut asks. */
function isDomainObject(name) {
  try {
    return isA(name, 'DatabaseObject');
  } catch {
    return false;
  }
}

/** DatabaseObject.toString: "Class {dbId=…, stId='…', displayName='…'}", no stId when there is none. */
function objectText(entity) {
  const { dbId, stId, displayName } = entity.properties;
  const id = stId === null || stId === undefined ? `dbId=${dbId}` : `dbId=${dbId}, stId='${stId}'`;
  return `${entity.schemaClass} {${id}, displayName='${displayName ?? null}'}`;
}

/** Has.toString. */
function relationText(relation) {
  const type = relation.type ?? SNAPSHOT().graph[relation.schemaClass]?.type;
  return `Has{type=${type}, stoichiometry=${relation.stoichiometry}, order=${relation.order}, element=${objectText(relation.element)}}`;
}

/**
 * ControllerUtils.toTSV: a DatabaseObject as its id (stable id, else dbId),
 * its text -- a getText's, through Jsoup, else its displayName -- and its
 * class, tab-separated; a collection as each of its items so written, one a
 * line; anything else as Java's toString writes it. `jsoupText` is passed in
 * (jsoup-text.ts).
 */
export function attributeText(
  value,
  jsoupText: (html: string) => string,
  getter?: { returns: string }
) {
  // A Double or Float getter: Double.toString, which writes 2.0 where JavaScript writes 2.
  if (typeof value === 'number' && getter && /^(Double|Float|double|float)$/.test(getter.returns))
    return javaDouble(value);
  if (value instanceof Entity) {
    const { stId, dbId, displayName } = value.properties;
    const textGetter = attributeGetter(value.schemaClass, 'text');
    // A `text` getter returns the object's text (a Summation's), a string.
    const text = textGetter ? jsoupText(getterResult(value, textGetter) as string) : displayName;
    const id = stId !== null && stId !== undefined && stId !== '' ? stId : String(dbId);
    return `${String(id)}\t${String(text ?? null)}\t${value.schemaClass}`;
  }
  if (Array.isArray(value))
    return value.map((item) => `${attributeText(item, jsoupText)}\n`).join('');
  if (value instanceof Relation) return relationText(value);
  if (value && typeof value === 'object' && value.javaClass) return value.javaClass;
  if (typeof value === 'number' && !Number.isInteger(value)) return javaDouble(value);
  return String(value);
}
