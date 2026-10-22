/**
 * The schema endpoints (spec 014, research R1, a family): /data/schema/*,
 * SchemaController's -- the class model, a class's objects (paged, minimal
 * or full) and counts -- with the helpers only they use. Named for the
 * family, as schema.ts is the model's class table. Moved unchanged from
 * service.ts.
 */
import type { Props } from './objects.ts';
import type { Answer, Endpoint, Request } from './endpoint.ts';
import { pathId, queryValues, rawSegment, springInteger, writerFor } from './spring.ts';
import { cached, javaError, javaJson, neo4jFailureMessage, nonEmptyJson } from './answers.ts';
import {
  attributeTable,
  isSchemaClass,
  isSpeciesClass,
  referralsTable,
  schemaClassOf,
  schemaModelTree,
} from './schema.ts';
import { javaNumeric } from './java-text.ts';
import { read } from './graph.ts';
import neo4j from 'neo4j-driver';
import type { SimpleDatabaseObject } from '../../projects/website-angular/src/model/content.model.ts';
import type { JsonWritten } from './answers.ts';
import { isA, mapNodes, writeDomain } from './domain.ts';

/** graph-core SchemaRepository.getSchemaClassCounts, as written. */
export const schemaModelQuery =
  'MATCH (n:DatabaseObject) RETURN DISTINCT LABELS(n) AS labels, Count(n) AS count';

/**
 * One page of a schema class, as SchemaController reads it for /min and for
 * the whole objects: `page` and `offset` are required Integers, read as
 * Spring reads them (springInteger), page first -- a missing or unreadable one
 * is Java's 400 before the class is looked at. Then offset capped at `cap`,
 * skip (page - 1) * offset in int arithmetic, and a negative skip or limit
 * passed to Neo4j, whose refusal is Java's 500. A class Java does not have is
 * its 500; a species for a class without one, or no rows, its 404.
 */
/** How a species narrows a schema query: by taxId, or by name. */
type By = 'taxId' | 'speciesName';

function schemaPage<R>({
  cap,
  query,
  answer,
  species: speciesFilter = true,
  accepts = (_className: string): boolean => true,
}: {
  cap: number;
  query: (className: string, by: By | undefined) => string;
  answer: (rows: R[], request: Request) => Answer;
  species?: boolean;
  accepts?: (className: string) => boolean;
}) {
  return async (request: Request) => {
    const className = pathId(rawSegment(request, 4));
    // In the controller's parameter order: species is a String and cannot
    // fail. /reference has no species parameter: one given is not read.
    const given = speciesFilter ? queryValues(request, 'species') : [];
    const page = springInteger(queryValues(request, 'page'), 'page');
    if (page.error !== undefined) return javaError(request, 400, 'BAD_REQUEST', page.error);
    const offset = springInteger(queryValues(request, 'offset'), 'offset');
    if (offset.error !== undefined) return javaError(request, 400, 'BAD_REQUEST', offset.error);

    if (!isSchemaClass(className)) return classNotFound(request);
    const none = () =>
      javaError(request, 404, 'NOT_FOUND', `No entries found for class: ${className}`);
    if (!accepts(className)) return none();
    const species = given.length ? given.join(',') : undefined;
    let by: By | undefined;
    if (species !== undefined) {
      if (!isSpeciesClass(className)) return none();
      by = javaNumeric(species) ? 'taxId' : 'speciesName';
    }
    const { skip, limit } = schemaWindow(page.value, offset.value, cap);
    let rows: R[];
    try {
      rows = await read<R>(query(className, by), {
        ...(by && { [by]: species }),
        skip: neo4j.int(skip),
        limit: neo4j.int(limit),
      });
    } catch (failure) {
      const message = neo4jFailureMessage(failure);
      if (message === undefined) throw failure;
      return javaError(request, 500, 'INTERNAL_SERVER_ERROR', message);
    }
    if (rows.length === 0) return none();
    return answer(rows, request);
  };
}

/**
 * graph-core's SchemaRepository.getSimpleReferencesObjectsByClass(Class, skip,
 * limit), as written: a reference class's objects by identifier.
 */
function schemaReferenceQuery(className: string) {
  return (
    `MATCH (n:${className}) ` +
    'RETURN n.dbId AS dbId, n.databaseName AS databaseName, n.identifier AS identifier ' +
    'ORDER BY n.identifier SKIP $skip LIMIT $limit'
  );
}

/**
 * graph-core's SimpleReferenceObject as Jackson writes it: identifier and
 * databaseName read with asString(), so a missing one is the text "null";
 * NON_EMPTY leaves out an empty one.
 */
/** A reference entity's row, as schemaReferenceQuery returns it. */
type ReferenceRow = { dbId: number; identifier: string | null; databaseName: string | null };

function simpleReferenceJson(row: ReferenceRow) {
  return nonEmptyJson([
    ['dbId', row.dbId],
    ['identifier', row.identifier ?? 'null'],
    ['databaseName', row.databaseName ?? 'null'],
  ]);
}

/**
 * graph-core's SchemaRepository.getByClass(Class, skip, limit) as written --
 * the order of rows sharing a name is the plan's, so the text is what keeps
 * every page Java's -- with the node's labels and id beside it, which the
 * domain objects need and read() does not keep.
 */
function schemaObjectsQuery(className: string, by: By | undefined) {
  return (
    `${schemaMatch(className, by)} RETURN n, labels(n) AS labels, id(n) AS id ` +
    'ORDER BY n.displayName SKIP $skip LIMIT $limit'
  );
}

/**
 * graph-core SchemaRepository's queries for /schema/{className}/min, by
 * species taxId, species name or neither. `className` is spliced in, as Java
 * splices it, and is only ever a name isSchemaClass accepted.
 */
export function schemaMinQuery(className: string, by: By | undefined) {
  return (
    `${schemaMatch(className, by)} ` +
    'RETURN DISTINCT(n.dbId) as dbId, n.stId as stId, n.displayName as displayName, labels(n) as labels ' +
    'ORDER BY n.displayName ' +
    'SKIP $skip LIMIT $limit'
  );
}

/**
 * The count for /schema/{className}/count. With a species, graph-core's query;
 * without, the label count Spring Data's `count(Class)` makes, which reads
 * Neo4j's count store. Quoted, because a woven `X$AjcClosure3` is a class too.
 */
export function schemaCountQuery(className: string, by?: By) {
  if (by === undefined) return `MATCH (n:\`${className}\`) RETURN count(n) AS n`;
  return `${schemaMatch(className, by)} RETURN COUNT(n) AS n`;
}

function schemaMatch(className: string, by: By | undefined) {
  if (by === 'taxId') return `MATCH (s:Species{taxId:$taxId})<-[:species]-(n:${className})`;
  if (by === 'speciesName') {
    return `MATCH (s:Species{displayName:$speciesName})<-[:species]-(n:${className})`;
  }
  return `MATCH (n:${className})`;
}

/**
 * SKIP and LIMIT as the controller and graph-core compute them: offset capped
 * at 20000, skip `(page - 1) * offset` in Java's int arithmetic, overflow and
 * all. Negative values are left for Neo4j to refuse, as Java leaves them.
 */
export function schemaWindow(page: number, offset: number, cap = 20000) {
  const limit = offset > cap ? cap : offset;
  return { skip: Math.imul((page - 1) | 0, limit), limit };
}

/** A row of the schema queries: the object's dbId, stId, displayName and labels. */
type SimpleObjectRow = {
  dbId: number;
  stId: string | null;
  displayName: string | null;
  labels: string[];
};

/**
 * graph-core's SimpleDatabaseObject as Jackson writes it. stId is read with
 * asString(null), so a missing one is left out; displayName with asString(),
 * which writes a missing one as the text "null". The class is the one the
 * labels name (schemaClassOf), not the schemaClass property.
 */
export function simpleObjectJson(row: SimpleObjectRow): SimpleDatabaseObject {
  const displayName = row.displayName ?? 'null';
  const out: JsonWritten<SimpleDatabaseObject> = {
    dbId: row.dbId,
    stId: row.stId !== null && row.stId !== '' ? row.stId : undefined,
    displayName: displayName !== '' ? displayName : undefined,
    schemaClass: schemaClassOf(row.labels),
  };
  // javaJson leaves the undefined ones out, as non_empty does.
  return out as SimpleDatabaseObject;
}

/** The ContentService's answer to a ClassNotFoundException. */
function classNotFound(request: Request) {
  return javaError(request, 500, 'INTERNAL_SERVER_ERROR', 'Specified class was not found');
}

export const schemaEndpoints: Endpoint[] = [
  {
    path: '/ContentService/data/schema/{id}/count',
    // The id is the class name; Java calls it {className}.
    sample: 'Pathway',
    // The error bodies name the service that answered; see /pathways/top/{id}.
    differs: [/^\/ContentService\/data\/schema\/[^/]+\/count: \.url: /],
    /**
     * How many objects of a schema class there are, optionally in one species.
     * The schema browser asks for it beside every class it lists.
     *
     * Two of Java's answers come from reflection over graph-core's classes --
     * whether the name is a class at all, and whether it has a species -- and
     * are answered here from schema.ts, which says how it was derived and how
     * to keep it current. A name that is not a class is Java's 500, case
     * included: `pathway` is not `Pathway`.
     *
     * Without a species this is Spring Data's count of the class's label, which
     * Neo4j answers from its count store: a few milliseconds, where Java takes
     * about a second for any class. With one, graph-core's query, the species
     * read as SchemaService reads it -- digits are a taxId, anything else a
     * displayName exactly as given -- and not as SpeciesService reads it
     * elsewhere: no dbId, no normalising the name. None found, a class without
     * a species, or an empty `species=` are all Java's 404.
     */
    handler: async (request) => {
      const className = pathId(rawSegment(request, 4));
      const given = queryValues(request, 'species');
      if (!isSchemaClass(className)) return classNotFound(request);
      if (given.length === 0) {
        const [row] = await read<{ n: number }>(schemaCountQuery(className));
        return { status: 200, body: String(row?.n ?? 0), type: 'application/json' };
      }
      // A String parameter given more than once is Spring's comma-joined value.
      const species = given.join(',');
      const none = () =>
        javaError(request, 404, 'NOT_FOUND', `No entries have been found for species: ${species}`);
      if (!isSpeciesClass(className)) return none();
      const by = javaNumeric(species) ? 'taxId' : 'speciesName';
      const [row] = await read<{ n: number }>(schemaCountQuery(className, by), { [by]: species });
      if (!row?.n) return none();
      return { status: 200, body: String(row.n), type: 'application/json' };
    },
  },
  {
    path: '/ContentService/data/schema/{id}/min',
    sample: 'Pathway',
    differs: [/^\/ContentService\/data\/schema\/[^/]+\/min: \.url: /],
    /**
     * One page of a schema class's objects, each as dbId, stId, name and
     * class: the schema browser's list of instances.
     *
     * graph-core's query, kept as written: the rows are ordered by name alone,
     * and the order of rows that share one -- thousands do in DatabaseObject --
     * is the plan's, so the same text is what keeps every page Java's.
     *
     * `page` and `offset` are required Integers, read as Spring reads them
     * (springInteger), page first: a missing or unreadable one is Java's 400
     * before the class is looked at. Then as the controller and graph-core do
     * it: offset capped at 20000, skip (page - 1) * offset in int arithmetic,
     * and a negative skip or limit passed to Neo4j, whose refusal is Java's
     * 500. A class Java does not have is its 500; a species for a class
     * without one, or no rows, its 404.
     */
    handler: schemaPage<SimpleObjectRow>({
      cap: 20000,
      query: schemaMinQuery,
      answer: (rows) => ({
        status: 200,
        body: javaJson(rows.map(simpleObjectJson)),
        type: 'application/json',
      }),
    }),
  },
  {
    path: '/ContentService/data/schema/model',
    /**
     * Every class with nodes in the graph, as a tree from DatabaseObject down,
     * each with how many nodes it and its subclasses hold: the schema
     * browser's class tree.
     *
     * DatabaseObjectUtils.getGraphModelTree over SchemaRepository's label
     * counts. The counts are the graph's and are read here; what Java gets by
     * reflection -- which class a set of labels names, and each class's
     * superclass -- comes from schema.ts (schemaModelTree, which says how the
     * tree is built). schema.spec.ts rebuilds the tree Java answered when the
     * snapshot was taken, from its own counts, byte for byte.
     *
     * Cached for the life of the process, as Java caches it (`cacheSchema`,
     * once per deployment): the counts change only when the database is
     * replaced, which restarts this -- see cached(). The query reads every
     * DatabaseObject, a few seconds, so it is paid at startup, not by a reader.
     */
    handler: cached('schema model', async () => {
      const rows = await read<{ labels: string[]; count: number }>(schemaModelQuery);
      const tree = schemaModelTree(rows);
      // Java's answer to an empty graph is an empty 200 that it does not cache;
      // a graph without a DatabaseObject is not one this serves.
      if (tree === undefined) throw new Error('schema model: the graph has no DatabaseObject');
      return { status: 200, body: tree, type: 'application/json' };
    }),
  },
  {
    path: '/ContentService/data/schema/{id}',
    sample: 'Pathway?page=1&offset=25',
    differs: [/^\/ContentService\/data\/schema\/[^/]+: \.url: /],
    /**
     * SchemaController.getDatabaseObjectsForClassName: one page of a class's
     * objects, whole -- graph-core's SchemaRepository.getByClass(Class, skip,
     * limit), the nodes alone (no relationship), written as the domain
     * objects. /min's rules (schemaPage), at most 25 to a page.
     */
    handler: schemaPage<{ id: number | string; labels: string[]; n: Props }>({
      cap: 25,
      query: schemaObjectsQuery,
      answer: (rows, request) => ({
        status: 200,
        serialised: writeDomain(
          mapNodes(rows.map((row) => ({ id: row.id, labels: row.labels, props: row.n }))),
          ...writerFor(request)
        ),
        type: 'application/json',
      }),
    }),
  },
  {
    path: '/ContentService/data/schema/{id}/reference',
    sample: 'ReferenceMolecule?page=1&offset=25',
    differs: [/^\/ContentService\/data\/schema\/[^/]+\/reference: \.url: /],
    /**
     * SchemaController.getSimpleReferencesObjectsByClassName: one page of a
     * reference class's objects -- dbId, identifier, database -- by
     * identifier. /min's rules (schemaPage), with no species parameter, at
     * most 20000 to a page, and a class that is neither a ReferenceEntity nor
     * an ExternalOntology (SchemaService.isValidReferenceClass) its 404.
     */
    handler: schemaPage<ReferenceRow>({
      cap: 20000,
      species: false,
      accepts: (className) =>
        isA(className, 'ReferenceEntity') || isA(className, 'ExternalOntology'),
      query: schemaReferenceQuery,
      answer: (rows) => ({
        status: 200,
        body: `[${rows.map(simpleReferenceJson).join(',')}]`,
        type: 'application/json',
      }),
    }),
  },
  {
    path: '/ContentService/data/schema/{id}/attributes',
    sample: 'Pathway',
    differs: [/^\/ContentService\/data\/schema\/[^/]+\/attributes: \.url: /],
    /**
     * A class's attributes, its own and inherited, each with its cardinality,
     * value types and the class declaring it: the schema browser's class page.
     *
     * DatabaseObjectUtils.getAttributeTable is reflection over graph-core's
     * classes and reads no database, so this is Java's answer captured once
     * (schema-snapshot.json, by snapshot-schema.ts) and composed as Java
     * composes it (schema.ts, attributeTable). A name Class.forName does not
     * find is Java's 500, as for /count.
     */
    handler: async (request) => {
      const table = attributeTable(pathId(rawSegment(request, 4)));
      if (table === undefined) return classNotFound(request);
      return { status: 200, body: javaJson(table), type: 'application/json' };
    },
  },
  {
    path: '/ContentService/data/schema/{id}/referrals',
    sample: 'Pathway',
    differs: [/^\/ContentService\/data\/schema\/[^/]+\/referrals: \.url: /],
    /**
     * The attributes of other classes that can point at this one: the schema
     * browser's "referrals". DatabaseObjectUtils.getReferrals, reflection
     * again, so captured like /attributes (schema.ts, referralsTable).
     */
    handler: async (request) => {
      const table = referralsTable(pathId(rawSegment(request, 4)));
      if (table === undefined) return classNotFound(request);
      return { status: 200, body: javaJson(table), type: 'application/json' };
    },
  },
];
