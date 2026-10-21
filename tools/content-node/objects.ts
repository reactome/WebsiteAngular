/**
 * Objects in the graph as graph-core finds and loads them (spec 014,
 * research R1 layer 5): an id resolved as Java resolves it (stable id, old
 * id, dbId), the species filter, the lazy loads behind a getter, and the
 * attribute answers built on them. Moved unchanged from service.ts.
 */
import type { GraphNode, Properties } from './graph.ts';
import { asciiDigits, databaseObjectSet, javaNumeric, javaTrim, present } from './java-text.ts';
import { notFound, only, unexpected } from './answers.ts';
import { read } from './graph.ts';
import {
  AttributeFailure,
  attributeGetter,
  attributeText,
  attributeValue,
  mapNodes,
} from './domain.ts';
import { jsoupText } from './jsoup-text.ts';
import neo4j from 'neo4j-driver';

/** A node's or map's properties, as read gives them. */
export type Props = Properties;

/**
 * Long.parseLong's 500 for the first id that is a dbId past a long, naming it
 * as Java read it (trimmed, any version cut), or undefined. neo4j.int would
 * wrap round instead and find some other object.
 */
export function longPastRange(ids) {
  for (const raw of ids) {
    const id = inDepthId(raw);
    if (id?.idType === 'dbId' && BigInt(id.id) > 9223372036854775807n)
      return `For input string: "${javaTrim(raw).split('.')[0]}"`;
  }
  return undefined;
}

/**
 * How Java reads an id, as a Cypher condition on `n`.
 *
 * Mirrors graph-core's DatabaseObjectUtils (getIdentifier, trimId, isStId,
 * isDbId) and AdvancedDatabaseObjectService.findById:
 *
 * - trimmed; an id without ':' is also cut at its first '.', so any version
 *   suffix is ignored (`R-HSA-70486.4`, `70486.3`). An id with ':' -- a
 *   reference, `UniProt:P04637` -- is only trimmed.
 * - `REACT_…` is a pre-2016 id: findNewStId looks up the node whose `oldStId`
 *   it is, and that node is the answer. Here that is one match on `oldStId`.
 * - starting with 'R', or containing ':', is a stable id; all digits is a
 *   dbId (leading zeros allowed, as Long.parseLong allows them). Anything else
 *   is not found, as in Java. Case matters: `r-hsa-70486` is not found.
 * - One known difference: `.` alone is Java's 500 (it indexes the empty
 *   result of the split); here it is a 404, the answer it should have been.
 *
 * Every branch matches one indexed property on DatabaseObject, never a
 * disjunction: a disjunction across properties uses no index and scans the
 * whole graph (see the person endpoints).
 */
export function resolveId(raw) {
  const trimmed = javaTrim(String(raw));
  const id = trimmed.includes(':') ? trimmed : (trimmed.split('.')[0] ?? '');
  if (id.startsWith('REACT_')) return { where: 'n.oldStId = $id', params: { id } };
  if (id.startsWith('R') || id.includes(':')) return { where: 'n.stId = $id', params: { id } };
  // StringUtils.isNumeric and Long.parseLong take a digit of any script.
  if (javaNumeric(id)) {
    return { where: 'n.dbId = toInteger($id)', params: { id: asciiDigits(id) } };
  }
  return { where: 'false', params: {} };
}

/**
 * A Pathway as graph-core's domain class serialises it when only the node is
 * loaded: these keys, in this order, absent values omitted. Measured from
 * Java's answers, which agree across 150 pathways: `oldStId` and the diagram
 * size are on the node but not written, and `className` repeats the class.
 */
export function pathwayJson(node) {
  // hasEHLD has a field default of false in Java, should a node lack it (none
  // does today); isCanonical is declared but on no node yet.
  const out = only({ ...node, hasEHLD: node.hasEHLD ?? false }, [
    'dbId',
    'displayName',
    'stId',
    'stIdVersion',
    'definition',
    'isInDisease',
    'isInferred',
    'maxDepth',
    'name',
    'releaseDate',
    'releaseStatus',
    'speciesName',
    'doi',
    'hasDiagram',
    'hasEHLD',
    'isCanonical',
    'lastUpdatedDate',
    'schemaClass',
  ]);
  if (node.schemaClass) out['className'] = node.schemaClass;
  return out;
}

/**
 * graph-core's DatabaseObjectUtils.getIdentifier then isStId / isDbId, as the
 * in-depth services read an id: trimmed, a version cut unless the id has a
 * ':', a pre-2016 REACT_ id translated to the object it was, then a stable id
 * if it starts with R or has a ':', else a dbId if numeric (any script's
 * digits), else nothing.
 */
export function inDepthId(raw) {
  const trimmed = javaTrim(raw);
  const id = trimmed.includes(':') ? trimmed : trimmed.split('.')[0];
  // getIdentifier swaps an old REACT_ id for the stable id it became: the
  // object whose oldStId it is.
  if (id.startsWith('REACT_')) return { idType: 'oldStId', id };
  if (id.startsWith('R') || id.includes(':')) return { idType: 'stId', id };
  if (javaNumeric(id)) return { idType: 'dbId', id: asciiDigits(id) };
  return undefined;
}

/**
 * An id as graph-core's services read it before choosing a repository query:
 * DatabaseObjectUtils.getIdentifier, then isStId or isDbId. Read as everywhere
 * else (resolveId); a pre-2016 REACT_ id is swapped for its stable id (findNewStId), and one
 * that is not found stays as given and is looked for as a stable id, which
 * finds nothing -- as in Java. Undefined for an id that is neither, for which
 * the service returns null.
 *
 * `object` is the pattern the query matches the object by, `params` its
 * parameters, `byDbId` whether it is the dbId query.
 */
export async function graphCoreId(raw) {
  let { where, params } = resolveId(raw);
  if (where === 'false') return undefined;
  if (where.startsWith('n.oldStId')) {
    const [found] = await read<{ stId: string | null }>(
      'MATCH (n:DatabaseObject) WHERE n.oldStId = $id RETURN n.stId AS stId LIMIT 1',
      params
    );
    params = { id: found?.stId ?? params.id };
    where = 'n.stId = $id';
  }
  const byDbId = where.startsWith('n.dbId');
  return { object: byDbId ? '{dbId: toInteger($id)}' : '{stId: $id}', params, byDbId };
}

/**
 * graph-core's AdvancedDatabaseObjectRepository.queryRelationshipTypesByDbId,
 * the query its LazyFetchAspect runs when a collection getter finds nothing
 * loaded: the objects of one relationship, in the relationship's order.
 */
export function lazyCollectionQuery(type, direction, schemaClass) {
  const [left, right] = direction === 'INCOMING' ? ['<-', '-'] : ['-', '->'];
  return `MATCH (a:DatabaseObject{dbId:$dbId})${left}[r:${type}]${right}(m:${schemaClass}) RETURN m, r.stoichiometry as n ORDER BY r.order`;
}

/**
 * ControllerUtils.getProperty on a loaded object, as an answer: the getter
 * found by name, its value, and toTSV's text of it (domain.ts); Java's 404
 * naming the attribute and the object's class when there is no getter or it
 * returns nothing.
 */
export async function attributeAnswer(request, object, attribute) {
  const answer = await attributeOf(request, object, attribute);
  if ('status' in answer) return answer;
  return { status: 200, body: answer.text, type: 'text/plain;charset=UTF-8' };
}

/**
 * ControllerUtils.getProperty's text for one object: {text}, or the answer
 * to give instead -- Java's 404 naming the attribute and the object's class
 * when there is no getter or it returns nothing, its 500 when the getter
 * fails. `outgoingLoaded` as attributeValue takes it.
 */
export async function attributeOf(request, object, attribute, { outgoingLoaded = true } = {}) {
  const missing = () =>
    notFound(
      request,
      `Attribute: '${attribute}' has not been found for object: ${object.schemaClass}`
    );
  const getter = attributeGetter(object.schemaClass, attribute);
  if (!getter) return missing();
  let value;
  try {
    value = await attributeValue(object, getter, lazyRelationship, { outgoingLoaded });
  } catch (failure) {
    // A NullPointerException inside a getter: Java's generic 500.
    if (failure instanceof AttributeFailure) return unexpected(request);
    throw failure;
  }
  if (value === undefined || value === null) return missing();
  return { text: attributeText(value, jsoupText, getter) };
}

/**
 * What LazyFetchAspect loads for a getter whose relationship is empty:
 * AdvancedDatabaseObjectService.findCollectionByRelationship (or, for a
 * single object, findByRelationship: the one, if there is exactly one) --
 * lazyCollectionQuery's
 * nodes of the getter's class, in the relationship's order, each as many
 * times as its stoichiometry -- as entities, one per node.
 */
async function lazyRelationship(dbId, type, direction, getter, collection) {
  const label = collection === '' ? getter.returns : getter.element;
  const rows = await read<{ m: GraphNode; n: number | null }>(
    lazyCollectionQuery(type, direction, label).replace(
      'RETURN m,',
      'RETURN {id: id(m), labels: labels(m), props: properties(m)} AS m,'
    ),
    { dbId: neo4j.int(dbId) }
  );
  // findByRelationship gives its object only when there is exactly one: two
  // `modified` edits make a pathway's getModified null, and Java's 404.
  if (collection === '') return rows.length === 1 ? mapNodes([present(rows[0]).m]) : [];
  // A getter returning java.util.Set: findCollectionByRelationship collects
  // the objects with Collectors.toSet -- one each, no stoichiometry, in a
  // HashSet's order (DatabaseObject.hashCode). Event.getInferredFrom is one.
  if (getter.returns === 'Set') return databaseObjectSet(mapNodes(rows.map((row) => row.m)));
  return mapNodes(rows.flatMap((row) => Array(row.n ?? 1).fill(row.m)));
}

/**
 * The `species` parameter as graph-core's SpeciesService.getSpecies reads it:
 * nothing when absent or empty; digits as a taxId, then as a dbId; anything
 * else as a name -- lower-cased, runs of '_' and ' ' made one space, first
 * letter capitalised -- matched against a Species' names.
 */
export function speciesFilter(raw) {
  if (raw === undefined || raw === '') return { kind: 'none' };
  if (javaNumeric(raw)) return { kind: 'number', value: raw };
  const name = raw.toLowerCase().replace(/[_ ]+/g, ' ');
  return { kind: 'name', value: name.charAt(0).toUpperCase() + name.slice(1) };
}

/** The taxId of the species a filter names, or undefined: none, or not found. */
export async function speciesTaxId(filter) {
  if (filter.kind === 'none') return undefined;
  if (filter.kind === 'number') {
    const [byTaxId] = await read<{ taxId: string | null }>(
      'MATCH (s:Species {taxId: $value}) RETURN s.taxId AS taxId LIMIT 1',
      filter
    );
    if (byTaxId) return byTaxId.taxId;
    const [byDbId] = await read<{ taxId: string | null }>(
      'MATCH (s:Species {dbId: toInteger($value)}) RETURN s.taxId AS taxId LIMIT 1',
      { value: asciiDigits(filter.value) }
    );
    return byDbId?.taxId ?? undefined;
  }
  const [byName] = await read<{ taxId: string | null }>(
    'MATCH (s:Species) WHERE $value IN s.name RETURN s.taxId AS taxId LIMIT 1',
    filter
  );
  return byName?.taxId ?? undefined;
}
