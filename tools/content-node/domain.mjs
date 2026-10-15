/**
 * graph-core's domain objects, as the Java content service loads and writes
 * them: the object graph Spring Data Neo4j builds from a query's nodes and
 * relationships, and the JSON Jackson writes from it.
 *
 * Nothing about the model is restated here. Which properties each class writes,
 * in what order and in which view, and how each field maps onto the graph, are
 * read from the deployed libraries by snapshot-domain.mjs into
 * domain-snapshot.json. What this file holds is the behaviour those libraries
 * have and a snapshot cannot carry: how SDN fills a field from relationships,
 * how Jackson writes a value, and the few getters that compute something
 * rather than return a field (COMPUTED, below).
 */
import { readFileSync } from 'node:fs';
import { schemaClassOf, supertypes } from './schema.mjs';

let snapshot;
/** domain-snapshot.json, read on first use: snapshot-domain.mjs imports this file to write it. */
function SNAPSHOT() {
  if (snapshot) return snapshot;
  const stored = JSON.parse(
    readFileSync(new URL('./domain-snapshot.json', import.meta.url), 'utf8')
  );
  // Stored interned (see snapshot-domain.mjs); expanded once here.
  const json = {};
  for (const [name, positions] of Object.entries(stored.json))
    json[name] = positions.map((position) => stored.properties[position]);
  const graph = {};
  for (const [name, entry] of Object.entries(stored.graph))
    graph[name] = { ...entry, fields: entry.fields.map((position) => stored.fields[position]) };
  snapshot = { json, graph, interfaces: new Set(stored.interfaces), store: stored.store };
  return snapshot;
}

/** StoichiometryView, as the bit each property's view mask uses. */
export const VIEW = { flatten: 1, nested: 2, nestedAggregated: 4 };

const PUBMED_URL = 'http://www.ncbi.nlm.nih.gov/pubmed/';

/** A node as SDN maps it: one instance per node, whatever reaches it. */
class Entity {
  constructor(id, schemaClass, properties) {
    this.id = id;
    this.schemaClass = schemaClass;
    this.properties = properties;
    this.fields = {};
  }
}

/** A relationship with properties (graph-core's Has subclasses): Input, HasComponent... */
class Relation {
  constructor(relationClass, element, properties, type) {
    this.schemaClass = relationClass;
    this.element = element;
    this.stoichiometry = properties.stoichiometry ?? 1;
    this.order = properties.order ?? 0;
    // Has.Default carries its relationship's name; the others' is fixed.
    if (type !== undefined) this.type = type;
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

const isA = (schemaClass, target) => supertypes(schemaClass).has(target);

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
export function mapResult({ root, nodes, relationships: returned, order }) {
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
  const state = {
    byId,
    position,
    relationships,
    removed: new Set(),
    processed: new Map(),
    known: new Map(),
    byEnd: new Map(),
  };
  for (const relationship of relationships) {
    for (const key of [
      `OUTGOING ${relationship.type} ${relationship.start}`,
      `INCOMING ${relationship.type} ${relationship.end}`,
    ]) {
      if (!state.byEnd.has(key)) state.byEnd.set(key, []);
      state.byEnd.get(key).push(relationship);
    }
  }
  return map(state, root, undefined);
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
function map(state, node, target) {
  const frames = [];
  const make = (from, to) => {
    const schemaClass = to ? classFor(to, from.labels) : schemaClassOf(from.labels);
    const entity = new Entity(from.id, schemaClass, from.props);
    // Known before its fields are filled, so a field leading back finds it.
    state.known.set(from.id, entity);
    const graph = SNAPSHOT().graph[schemaClass];
    if (graph) {
      for (const field of graph.fields)
        if (field.length === 2)
          entity.fields[field[0]] = entity.properties[field[1]] ?? graph.defaults?.[field[0]];
      frames.push({ entity, fields: graph.fields.filter((field) => field.length > 2), at: 0 });
    }
    return entity;
  };
  const root = make(node, target);
  while (frames.length) {
    const frame = frames[frames.length - 1];
    if (!frame.matching) {
      if (frame.at === frame.fields.length) {
        frames.pop();
        continue;
      }
      frame.matching = matchingFor(state, frame.entity, frame.fields[frame.at]);
      frame.next = 0;
      frame.found = [];
    }
    const [name, , direction, target, collection, relationClass] = frame.fields[frame.at];
    if (frame.next === frame.matching.length) {
      frame.entity.fields[name] = collect(frame.found, collection, relationClass);
      frame.matching = undefined;
      frame.at += 1;
      continue;
    }
    const relationship = frame.matching[frame.next];
    frame.next += 1;
    const key = `${direction} ${relationship.id}`;
    const used = state.processed.get(key) ?? 0;
    if (used === 2) state.removed.add(relationship.id);
    else state.processed.set(key, used + 1);
    const otherId = direction === 'OUTGOING' ? relationship.end : relationship.start;
    // A new entity pushes its frame: its fields are filled before this one goes on.
    const other =
      otherId === frame.entity.id
        ? frame.entity
        : (state.known.get(otherId) ?? make(state.byId.get(otherId), target));
    frame.found.push(
      relationClass ? new Relation(relationClass, other, relationship.props) : other
    );
  }
  return root;
}

/** One field's relationships, in candidate order (see map). */
function matchingFor(state, entity, [, type, direction, target]) {
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
function classFor(target, labels) {
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
  const rank = relationClass ? (item) => item.order : (item) => Number(item.properties.dbId);
  const sorted = [];
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
 * other getter Jackson calls returns its field (snapshot-domain.mjs checks the
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
};

/** The computed getters, by name, for snapshot-domain.mjs to check against graph-core. */
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
  return SNAPSHOT().graph[target.schemaClass].type;
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
export function writeDomain(value, view = VIEW.flatten, { jsog = false } = {}) {
  // Iterative, not recursive: an in-depth answer nests thousands of objects
  // deep, which overflowed the stack, and building each level's text to hand
  // to the level above copied the same bytes once per level. Pieces go into
  // one array, joined once. Work is a stack of what is still to be written,
  // in reverse; an object is opened -- and, being an entity, marked written
  // -- when it is taken off, so references fall exactly where they did when
  // this recursed.
  const out = [];
  const seen = new Map();
  const work = [{ value, floating: false }];
  while (work.length) {
    const item = work.pop();
    if (typeof item === 'string') {
      out.push(item);
      continue;
    }
    const { value: current, floating } = item;
    if (current instanceof Entity) {
      if (seen.has(current)) {
        out.push(jsog ? `{"@ref":"${seen.get(current)}"}` : number(current.fields.dbId));
        continue;
      }
      seen.set(current, seen.size + 1);
      open(out, work, current, view, jsog ? `"@id":"${seen.size}"` : undefined);
    } else if (current instanceof Relation) {
      open(out, work, current, view);
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
function open(out, work, target, view, first) {
  const members = [];
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
    const [name, value, floating] = members[at];
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

/** A whole number as Java writes a Long; graph.mjs hands an unsafe one over as text. */
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
  { anchor = 'n:DatabaseObject', ordered = true, without } = {}
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
 * Nodes on their own, as SDN maps a query that returns only nodes: each with
 * its properties and no relationships, one instance per node, so a node that
 * comes back twice is the same object -- and written the second time as its
 * dbId.
 */
export function mapNodes(nodes) {
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
export function findByIdParameters(labels) {
  const keep = {};
  for (const [, type, direction, target] of SNAPSHOT().graph[schemaClassOf(labels)]?.fields ?? []) {
    if (direction !== 'OUTGOING') continue;
    keep[type] ??= [];
    if (!keep[type].includes(target)) keep[type].push(target);
  }
  return { keep };
}
