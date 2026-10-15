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
  // A relationship returned twice -- on two paths, in-depth -- is one
  // relationship to SDN: kept where it first appears.
  const seenRelationships = new Set();
  const relationships = returned.filter(
    (relationship) =>
      relationship.id === undefined ||
      (!seenRelationships.has(relationship.id) && seenRelationships.add(relationship.id))
  );
  const entities = new Map();
  const rootClass = schemaClassOf(root.labels);
  entities.set(root.id, new Entity(root.id, rootClass, root.props));
  const byId = new Map(nodes.filter(Boolean).map((node) => [node.id, node]));
  // A related node's class is chosen for the root's field that reaches it.
  for (const field of SNAPSHOT().graph[rootClass]?.fields ?? []) {
    if (field.length === 2) continue;
    const [, type, direction, target] = field;
    for (const relationship of relationships) {
      if (relationship.type !== type) continue;
      const outgoing = direction === 'OUTGOING';
      if ((outgoing ? relationship.start : relationship.end) !== root.id) continue;
      const node = byId.get(outgoing ? relationship.end : relationship.start);
      if (!node || entities.has(node.id)) continue;
      entities.set(node.id, new Entity(node.id, classFor(target, node.labels), node.props));
    }
  }
  for (const node of byId.values())
    if (!entities.has(node.id))
      entities.set(node.id, new Entity(node.id, schemaClassOf(node.labels), node.props));
  // The order SDN visits related nodes in: first appearance in the result.
  const position = new Map();
  for (const id of [root.id, ...(order ?? nodes.filter(Boolean).map((node) => node.id))])
    if (!position.has(id)) position.set(id, position.size);
  // Each relationship under both of its ends, so a field finds its own at once.
  const byEnd = new Map();
  const add = (key, relationship) => {
    if (!byEnd.has(key)) byEnd.set(key, []);
    byEnd.get(key).push(relationship);
  };
  for (const relationship of relationships) {
    add(`OUTGOING ${relationship.type} ${relationship.start}`, relationship);
    add(`INCOMING ${relationship.type} ${relationship.end}`, relationship);
  }
  for (const entity of entities.values()) fill(entity, entities, byEnd, position);
  return entities.get(root.id);
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

/**
 * One entity's fields. A relationship field is filled node by node, in the
 * order the nodes first appear in the result, and only then relationship by
 * relationship -- not in the relationships' own order. The difference shows
 * when one node is reached twice: an entity that is both a reaction's input
 * (order 2) and its output (order 1) is the *first* output, because it was
 * met among the inputs; Java writes R-CEL-156804's reaction that way.
 */
function fill(entity, entities, byEnd, position) {
  const graph = SNAPSHOT().graph[entity.schemaClass];
  if (!graph) return;
  for (const field of graph.fields) {
    if (field.length === 2) {
      entity.fields[field[0]] = entity.properties[field[1]] ?? graph.defaults?.[field[0]];
      continue;
    }
    const [name, type, direction, target, collection, relationClass] = field;
    const outgoing = direction === 'OUTGOING';
    const otherEnd = (relationship) => (outgoing ? relationship.end : relationship.start);
    // Stable: relationships to the same node keep their own order.
    const matching = [...(byEnd.get(`${direction} ${type} ${entity.id}`) ?? [])].sort(
      (a, b) => position.get(otherEnd(a)) - position.get(otherEnd(b))
    );
    const found = [];
    for (const relationship of matching) {
      const other = entities.get(otherEnd(relationship));
      if (!other || !isA(other.schemaClass, target)) continue;
      found.push(relationClass ? new Relation(relationClass, other, relationship.props) : other);
    }
    entity.fields[name] = collect(found, collection, relationClass);
  }
}

/** The field's collection as SDN creates it: ArrayList, LinkedHashSet, TreeSet. */
function collect(found, collection, relationClass) {
  if (collection === '') return found.length ? found[found.length - 1] : undefined;
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
 * follow. The default (flatten) view matched Java byte for byte over 20,279
 * objects of every class.
 */
export function writeDomain(value, view = VIEW.flatten, { jsog = false } = {}) {
  return write(value, { view, jsog, seen: new Map() });
}

function write(value, context, floating = false) {
  if (value instanceof Entity) {
    const { seen, jsog } = context;
    if (seen.has(value)) return jsog ? `{"@ref":"${seen.get(value)}"}` : number(value.fields.dbId);
    seen.set(value, seen.size + 1);
    return members(value, context, jsog ? `"@id":"${seen.size}"` : undefined);
  }
  if (value instanceof Relation) return members(value, context);
  if (Array.isArray(value))
    return `[${value.map((item) => write(item, context, floating)).join(',')}]`;
  if (typeof value === 'string') return javaString(value);
  if (typeof value === 'boolean') return String(value);
  if (typeof value === 'number') return floating ? javaDouble(value) : number(value);
  if (typeof value === 'bigint') return String(value);
  throw new Error(`domain: cannot write ${typeof value}`);
}

function members(target, context, first) {
  const parts = first ? [first] : [];
  for (const [name, source, views, floating] of SNAPSHOT().json[target.schemaClass] ?? []) {
    if (!(views & context.view)) continue;
    const value = valueOf(target, source);
    if (empty(value)) continue;
    parts.push(`${javaString(name)}:${write(value, context, floating === 'D')}`);
  }
  return `{${parts.join(',')}}`;
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
 * The lists come back as Java collects them, a list per row, flattened here
 * in order; a relationship on several paths is deduplicated by mapResult.
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
     RETURN ${node('root')} AS root,
            [list IN nodeLists | [n IN list | ${node('n')}]] AS nodeLists,
            [list IN relationshipLists | [r IN list | ${rel('r')}]] AS relationshipLists`;
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
