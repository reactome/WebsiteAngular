/**
 * The data query endpoints (spec 014, research R1, a family): an object by
 * id and its attributes (/data/query/*), the batch lookups, the database's
 * name and version (/data/database/*), diseases, the schema.org discover
 * view and an instance's referrers, with the helpers only they use. Moved
 * unchanged from service.ts.
 */
import type { Endpoint } from './endpoint.ts';
import { asciiDigits, databaseObjectSet, javaNumeric, javaTrim } from './java-text.ts';
import {
  attributeAnswer,
  graphCoreId,
  inDepthId,
  lazyCollectionQuery,
  longPastRange,
  resolveId,
} from './objects.ts';
import { read } from './graph.ts';
import type { GraphNode } from './graph.ts';
import {
  JsonMap,
  enhancedQuery,
  findByIdParameters,
  findByIdQuery,
  isA,
  mapNodes,
  mapResult,
  oldEnhancedQuery,
  rootLabelsQuery,
  summaryEntity,
  writeDomain,
} from './domain.ts';
import type { DomainEntity, MappedRow } from './domain.ts';
import { JavaHashMap } from './java-hashmap.ts';
import neo4j from 'neo4j-driver';
import type { Props } from './objects.ts';
import { databaseVersion } from './release.ts';
import { cached, javaError, notFound, springNotFound } from './answers.ts';
import { pathId, queryValues, rawSegment, springPrimitiveBoolean, writerFor } from './spring.ts';
import { orthologyIds, plainText, plainTextProblem } from './body.ts';
import { schemaClassOf } from './schema.ts';
import type { InstanceReferrals, SimpleDatabaseObject } from '../../projects/contract/content.ts';
import type { JsonWritten } from './answers.ts';

/**
 * What graph-core's findById throws on, for ids looked up one at a time, in
 * order -- so the first bad id decides: an id of dots (trimId splits it on
 * '.' to nothing, an ArrayIndexOutOfBounds) or a dbId past a long.
 * Undefined when Java would throw on none.
 */
function findByIdFailure(ids: string[]) {
  for (const raw of ids) {
    const trimmed = javaTrim(raw);
    if (/^\.+$/.test(trimmed)) return 'Index 0 out of bounds for length 0';
    const refused = longPastRange([raw]);
    if (refused) return refused;
  }
  return undefined;
}

/** graph-core's SchemaRepository.getByClass(Disease): the nodes alone, by displayName. */
async function diseases() {
  const rows = await read<{ n: GraphNode }>(
    'MATCH (n:Disease) WITH n ORDER BY n.displayName RETURN {id: id(n), labels: labels(n), props: properties(n)} AS n'
  );
  return rows.map((row) => row.n);
}

/**
 * One object with everything it points to, as graph-core's
 * findById(id, OUTGOING) gives it; undefined when there is none.
 */
async function findObject(raw: string) {
  const { where, params } = resolveId(raw);
  if (where === 'false') return undefined;
  const [found] = await read<{ labels: string[] }>(rootLabelsQuery(where), params);
  if (!found) return undefined;
  const [row] = await read<MappedRow>(findByIdQuery(where), {
    ...params,
    ...findByIdParameters(found.labels),
  });
  return row ? mapResult(row) : undefined;
}

/** A java.util.HashMap<String, V> of these entries, put in this order, as its iteration order. */
export function idKeyedMap<V>(entries: [string, V][]) {
  const map = new JavaHashMap<string, V>();
  for (const [key, value] of entries) map.set(key, value);
  return [...map.entries()];
}

/**
 * One object as ControllerUtils.toTSV writes it for `/data/query/{id}/{attr}`:
 * the stable id (the dbId when there is none or it is empty), the name and the
 * class, tab-separated, with no newline after. A missing name is Java's string
 * concatenation of null. toTSV prefers a `getText()` over the name; no class
 * served through here has one, so it is not read.
 */
export function databaseObjectTsv({
  dbId,
  stId,
  displayName,
  schemaClass,
}: {
  dbId: number | string;
  stId: string | null | undefined;
  displayName: string | null;
  schemaClass: string;
}) {
  const id = stId !== null && stId !== undefined && stId !== '' ? stId : dbId;
  return `${id}\t${displayName ?? 'null'}\t${schemaClass}`;
}

/**
 * QueryObjectController.needsIncomingRelationship, on the id as it came (not
 * as getIdentifier reads it): a stable id needs them unless it is a chemical
 * (R-ALL-, chebi:); a dbId -- Long.valueOf, so a sign but no padding -- unless
 * the object is a Species, Summation, Person, Compartment or SimpleEntity.
 * Anything Long.valueOf refuses, or no such object, is Java's caught
 * exception: false.
 */
export async function needsIncoming(raw: string) {
  if (raw.startsWith('R') || raw.includes(':'))
    return !raw.startsWith('R-ALL-') && !raw.startsWith('chebi:');
  const sign = /^[+-]/.test(raw) ? raw.charAt(0) : '';
  const digits = raw.slice(sign.length);
  if (!javaNumeric(digits)) return false;
  const value = BigInt(`${sign === '-' ? '-' : ''}${asciiDigits(digits)}`);
  if (value > 9223372036854775807n || value < -9223372036854775808n) return false;
  const [row] = await read<{ needs: boolean }>(
    `MATCH (n:DatabaseObject) WHERE n.dbId = $id
     RETURN NOT (n:Species OR n:Summation OR n:Person OR n:Compartment OR n:SimpleEntity) AS needs`,
    { id: neo4j.int(value.toString()) }
  );
  return row?.needs ?? false;
}

/** The fields schemaDataSet reads lazily, as graph-core's domain declares them. */
const LAZY_FIELDS: Record<'author' | 'affiliation', [direction: string, schemaClass: string]> = {
  author: ['INCOMING', 'Person'],
  affiliation: ['OUTGOING', 'Affiliation'],
};

/**
 * What LazyFetchAspect loads for one field of the object with this dbId: each
 * object with its relationship's stoichiometry, as [properties, n].
 * findCollectionByRelationship adds an object that many times.
 */
async function lazyCollection(
  dbId: number,
  field: keyof typeof LAZY_FIELDS
): Promise<[Props, number][]> {
  const [direction, schemaClass] = LAZY_FIELDS[field];
  const rows = await read<{ m: Props; n: number | null }>(
    lazyCollectionQuery(field, direction, schemaClass),
    {
      dbId: neo4j.int(dbId),
    }
  );
  return rows.map((row): [Props, number] => [row.m, row.n ?? 1]);
}

/** graph-core's SchemaDataDownloadType, in declaration order: format, address. */
const SCHEMA_DOWNLOADS: [fileFormat: string, address: string][] = [
  ['SBML', 'https://reactome.org/ContentService/exporter/sbml/__ID__.xml'],
  ['SBGN', 'https://reactome.org/ReactomeRESTfulAPI/RESTfulWS/sbgnExporter/__ID__'],
  ['BIOPAX2', 'https://reactome.org/ReactomeRESTfulAPI/RESTfulWS/biopaxExporter/Level2/__ID__'],
  ['BIOPAX3', 'https://reactome.org/ReactomeRESTfulAPI/RESTfulWS/biopaxExporter/Level3/__ID__'],
  ['PDF', 'https://reactome.org/cgi-bin/pdfexporter?DB=gk_current&ID=__ID__'],
  ['DOCX', 'https://reactome.org/cgi-bin/rtfexporter?DB=gk_current&ID=__ID__'],
  ['OWL', 'https://reactome.org/cgi-bin/protegeexporter?DB=gk_current&ID=__ID__'],
];

/**
 * graph-core's SchemaDataSet(event, version), written as Jackson writes it:
 * fields in declaration order, then the getters license, @context and @type;
 * a null or empty value omitted. `lazy(dbId, field)` stands for
 * LazyFetchAspect (lazyCollection).
 *
 * - description: the first summation's text, "" when there is none --
 *   which NON_EMPTY then leaves out.
 * - version: String.valueOf of the release number -- "null" without one.
 * - creator: for each edit that authored the event, each of its authors, as
 *   often as the relationship's stoichiometry says (SchemaPerson). The edits
 *   come with the event, in the derived query's order; their authors, and
 *   each author's affiliations, are not loaded and come lazily, in
 *   relationship order. Measured on twelve events: any other mix of the two
 *   orders disagrees with Java on one.
 * - citation: each reference's address -- a LiteratureReference's PubMed URL
 *   (its computed getUrl), a Book's ISBN, anything else its displayName --
 *   skipping one that has none.
 *
 * `event` is the object as the handler reads it: its schemaClass and
 * properties, its summations' texts, its references and the dbIds of the
 * edits that authored it, each list in the order findById's derived query
 * gives.
 */
/** The event schemaDataSet describes, as its handler reads it. */
interface SchemaEvent {
  schemaClass: string;
  properties: Record<string, unknown>;
  summations?: unknown[];
  references?: Props[];
  authored?: unknown[];
}

export async function schemaDataSet(
  event: SchemaEvent,
  version: number | null,
  lazy: (dbId: number, field: 'author' | 'affiliation') => Promise<[Props, number][]>
) {
  // Jackson's NON_EMPTY, ContentService's setting: no null, "" or [].
  const kept = (name: string, value: unknown) =>
    value === null || value === undefined || value === '' || (Array.isArray(value) && !value.length)
      ? {}
      : { [name]: value };
  const expand = (pairs: [Props, number][]) =>
    pairs.flatMap(([object, n]) => Array<Props>(n).fill(object));
  const creator: unknown[] = [];
  // The authoring edits' dbIds, and each Person and Affiliation's properties.
  for (const edit of event.authored ?? []) {
    for (const person of expand(await lazy(edit as number, 'author'))) {
      const affiliation = expand(await lazy(person['dbId'] as number, 'affiliation')).map(
        (org) => ({
          ...kept('name', org['displayName']),
          '@type': 'Organization',
        })
      );
      creator.push({
        ...kept('givenName', person['firstname']),
        ...kept('familyName', person['surname']),
        ...kept('affiliation', affiliation),
        url: `http://europepmc.org/authors/${String(person['orcidId'] ?? 'null')}`,
        '@type': 'Person',
      });
    }
  }
  const citation: unknown[] = [];
  for (const reference of event.references ?? []) {
    const cited =
      reference['schemaClass'] === 'LiteratureReference'
        ? reference['pubMedIdentifier'] == null
          ? null
          : `http://www.ncbi.nlm.nih.gov/pubmed/${String(reference['pubMedIdentifier'])}`
        : reference['schemaClass'] === 'Book'
          ? reference['ISBN']
          : reference['displayName'];
    if (cited != null) citation.push(cited);
  }
  const summations = event.summations ?? [];
  const description = summations.length ? summations[0] : '';
  const dbId = event.properties['dbId'];
  return {
    ...kept('name', event.properties['displayName']),
    ...kept('description', description),
    url: `https://reactome.org/PathwayBrowser/#/${String(event.properties['stId'] ?? 'null')}`,
    version: String(version ?? 'null'),
    keywords: [event.schemaClass],
    ...kept('creator', creator),
    includedInDataCatalog: {
      name: 'Reactome',
      url: 'https://reactome.org',
      '@type': 'DataCatalog',
    },
    distribution: SCHEMA_DOWNLOADS.map(([fileFormat, address]) => ({
      contentUrl: address.replace('__ID__', String(dbId)),
      fileFormat,
      encodingFormat: 'UTF-8',
      '@type': 'DataDownload',
    })),
    ...kept('citation', citation),
    license: 'https://creativecommons.org/licenses/by/4.0/',
    '@context': 'http://schema.org/',
    '@type': 'DataSet',
  };
}

export const dataQueryEndpoints: Endpoint[] = [
  {
    path: '/ContentService/data/database/version',
    // The release the database holds. One row, one value: the smallest possible
    // first port, chosen to prove the plumbing rather than the mapping -- and it
    // still caught a wrong guess. The property is `releaseNumber`; `version` does
    // not exist on DBInfo and returned null, which the diff reported against
    // Java's 97 before anything could be switched on.
    /**
     * Cached, like every other list here, and for a sharper reason: measured
     * against Java, this answered in 286ms where Java took 1.1ms, because Java
     * holds the value and this went to the graph on every request. The site
     * asks for the release on every page load -- it is what keys the bucket
     * paths for diagrams, figures and icons -- so that was the most-called
     * endpoint of the set and the slowest.
     *
     * Safe for the same reason Java's is: the release number changes when the
     * database is replaced, and that restarts the service.
     *
     * Not fixable with an index on this instance, and the reason is worth
     * knowing before porting anything else: there is no token index here, so
     * `MATCH (n:DBInfo)` plans as `AllNodesScan + Filter` and reads all
     * 2,958,129 nodes to find one. ~700ms, and the same for any label-only
     * match -- which is why Java's `/data/species/main` takes 682ms too. See
     * the note on `read` in graph.ts.
     *
     * Caching is the fix available from this side. The service warms every
     * `cached` handler at startup, so the scan is paid once, off the request
     * path, and never by a reader.
     */
    handler: databaseVersion,
  },
  {
    path: '/ContentService/data/database/name',
    handler: cached('database/name', async () => {
      const [row] = await read<{ name: string | null }>(
        'MATCH (n:DBInfo) RETURN n.name AS name LIMIT 1'
      );
      if (!row) return { status: 404, body: 'no DBInfo node' };
      return { status: 200, body: String(row.name), type: 'text/plain;charset=UTF-8' };
    }),
  },
  {
    path: '/ContentService/data/query/enhanced/v2/{id}',
    sample:
      'R-HSA-70486?fetchIncomingRelationships=true&summariseReferenceEntity=true&includeDisease=true&includeRef=true&view=nested-aggregated',
    differs: [/^\/ContentService\/data\/query\/enhanced\/v2\/[^/]+[^:]*: \.url: /],
    /**
     * An object with everything around it, for the Pathway Browser's details
     * panel and the website's detail pages -- the site's busiest content
     * call. graph-core's findEnhancedObjectById (enhancedQuery), written by
     * the domain serialiser in the request's view; a reference entity, when
     * asked to summarise, as the content service's SummaryEntity
     * (summaryEntity).
     *
     * As QueryObjectController: three primitive booleans with defaults
     * (fetchIncomingRelationships true, summariseReferenceEntity false,
     * includeDisease true); incoming relationships only when asked for and
     * needsIncoming agrees; an object found only with its disease data,
     * asked for without, looked up again with it.
     */
    handler: async (request) => {
      const raw = pathId(rawSegment(request, 6));
      const flags: {
        fetchIncomingRelationships?: boolean;
        summariseReferenceEntity?: boolean;
        includeDisease?: boolean;
      } = {};
      for (const [name, fallback] of [
        ['fetchIncomingRelationships', true],
        ['summariseReferenceEntity', false],
        ['includeDisease', true],
      ] as const) {
        const parsed = springPrimitiveBoolean(queryValues(request, name), fallback);
        if (parsed.error !== undefined) return javaError(request, 400, 'BAD_REQUEST', parsed.error);
        flags[name] = parsed.value;
      }
      const id = inDepthId(raw);
      const missing = () => notFound(request, `Id: ${raw} has not been found in the System`);
      if (!id) return missing();
      const options = {
        idType: id.idType,
        summarise: flags.summariseReferenceEntity,
        includeDisease: flags.includeDisease,
        outgoingOnly: !(flags.fetchIncomingRelationships && (await needsIncoming(raw))),
      };
      let [row] = await read<MappedRow>(enhancedQuery(options), { id: id.id });
      if (!row && !options.includeDisease)
        [row] = await read<MappedRow>(enhancedQuery({ ...options, includeDisease: true }), {
          id: id.id,
        });
      if (!row) return missing();
      const found = mapResult(row);
      const object =
        flags.summariseReferenceEntity && isA(found.schemaClass, 'ReferenceEntity')
          ? summaryEntity(found)
          : found;
      return {
        status: 200,
        serialised: writeDomain(object, ...writerFor(request)),
        type: 'application/json',
      };
    },
  },
  {
    // Before /query/{id}/stId and /normalPathway, as Spring ranks its literal
    // `enhanced` above their {id}: /query/enhanced/stId is this, with id stId.
    path: '/ContentService/data/query/enhanced/{id}',
    sample: 'R-HSA-70486',
    differs: [/^\/ContentService\/data\/query\/enhanced\/[^/]+: \.url: /],
    /**
     * An object with its neighbours and some of theirs: graph-core's
     * findOldEnhancedObjectById (oldEnhancedQuery), written by the domain
     * serialiser in the request's view. The entity popup, the website's
     * content pages and the IDG panel read it.
     *
     * Kept byte for byte as Java answers it, so it keeps a trap: an object is
     * written in full only once, later as its bare dbId, and since graph-core
     * bb5e0ca0 (Aug 2025) an event's parent pathways (`eventOf`) come before its
     * own lists. A reference its parent also cites is therefore a bare number
     * in the event's `literatureReference`, and a reader that keeps only
     * objects loses it, which is #760 on production. Read an event's lists
     * from /query/enhanced/v2 (full objects), as the details pages do.
     *
     * Its relationships go both ways unless QueryObjectController's
     * needsIncomingRelationship says not (needsIncoming). The id is read as
     * getIdentifier reads it (inDepthId).
     */
    handler: async (request) => {
      const raw = pathId(rawSegment(request, 5));
      const id = inDepthId(raw);
      const missing = () => notFound(request, `Id: ${raw} has not been found in the System`);
      if (!id) return missing();
      const outgoingOnly = !(await needsIncoming(raw));
      const [row] = await read<MappedRow>(oldEnhancedQuery({ idType: id.idType, outgoingOnly }), {
        id: id.id,
      });
      if (!row) return missing();
      return {
        status: 200,
        serialised: writeDomain(mapResult(row), ...writerFor(request)),
        type: 'application/json',
      };
    },
  },
  {
    path: '/ContentService/data/query/{id}/stId',
    // A reaction by dbId, so the comparison covers the lookup the site makes.
    sample: '70486',
    // The 404 body names the service that answered; see /pathways/top/{id}.
    differs: [/^\/ContentService\/data\/query\/[^/]+\/stId: \.url: /],
    /**
     * An object's stable id, asked for as text.
     *
     * The site calls this whenever it meets a dbId -- an old link, a legacy
     * fragment, a URL parameter -- to swap it for the stable id: 13 bytes, where
     * fetching the object to read one field is 12KB. Java serves it from the
     * general `/data/query/{id}/{attributeName}`; only this attribute is ported,
     * so the route is exact.
     *
     * The id is resolved as Java resolves it (see resolveId): a stable id, a
     * pre-2016 REACT_ id or a dbId, with any version suffix ignored. An object
     * that has no stable id -- a Species, an InstanceEdit -- is Java's 404 with
     * its own message, not an empty 200.
     */
    handler: async (request) => {
      const raw = pathId(rawSegment(request, 4));
      const { where, params } = resolveId(raw);
      const rows = await read<{ stId: string | null; schemaClass: string | null }>(
        `MATCH (n:DatabaseObject) WHERE ${where}
         RETURN n.stId AS stId, n.schemaClass AS schemaClass LIMIT 1`,
        params
      );
      const [row] = rows;
      if (!row) return notFound(request, `Id: ${raw} has not been found in the System`);
      if (row.stId === null)
        return notFound(
          request,
          // The attribute as it was sent: routing matched it ignoring case.
          `Attribute: '${pathId(rawSegment(request, 5))}' has not been found for object: ${String(row.schemaClass)}`
        );
      return { status: 200, body: String(row.stId), type: 'text/plain;charset=UTF-8' };
    },
  },
  {
    path: '/ContentService/data/query/{id}',
    // A reaction: inputs with stoichiometry, a catalyst, preceding events.
    sample: 'R-HSA-70486',
    differs: [
      // The 404 body names the service that answered; see /pathways/top/{id}.
      /^\/ContentService\/data\/query\/[^/]+: \.url: /,
      // JSOG numbers objects in the order it meets them, and in the nested
      // views Java meets some properties in an order it does not keep from one
      // start to the next (domain.ts, writeDomain): R-HSA-5672965's inputs
      // and outputs swap. The references still agree within each answer.
      /^[^:]*(?=[^:]*includeRef=true)(?=[^:]*view=nested)[^:]*: \S*\.@(id|ref): /,
    ],
    /**
     * One object with everything it points to: graph-core's
     * findById(id, OUTGOING), written as Java's Jackson writes it (domain.ts
     * does both). The Pathway Browser's details panel and the website's detail
     * pages read it for every object they show.
     *
     * Java's message converter reads two parameters on every response it
     * writes: `view` picks the StoichiometryView (nested, nested-aggregated,
     * or flatten for anything else) and `includeRef=true` swaps dbId
     * references for JSOG's @id/@ref. Both are read here as the servlet reads
     * them -- the first value, `true` in any case.
     */
    handler: async (request) => {
      const raw = pathId(rawSegment(request, 4));
      const object = await findObject(raw);
      if (!object) return notFound(request, `Id: ${raw} has not been found in the System`);
      return {
        status: 200,
        serialised: writeDomain(object, ...writerFor(request)),
        type: 'application/json',
      };
    },
  },
  ...[
    {
      path: '/ContentService/data/query/ids',
      signature:
        'public java.util.Collection<org.reactome.server.graph.domain.model.DatabaseObject> org.reactome.server.service.controller.graph.QueryObjectController.findByIds(java.lang.String)',
      // QueryObjectController.findByIds: graph-core's findByIds, each id's
      // findById gathered in a HashSet -- written in that set's order.
      answer: (found: [string, DomainEntity][]) =>
        databaseObjectSet(found.map(([, object]) => object)),
    },
    {
      path: '/ContentService/data/query/ids/map',
      signature:
        'public java.util.Map<java.lang.String, org.reactome.server.graph.domain.model.DatabaseObject> org.reactome.server.service.controller.graph.QueryObjectController.findByIdsMap(java.lang.String)',
      // QueryObjectController.findByIdsMap: each id as sent to its object, in
      // a HashMap -- written in that map's order. Each object is its own
      // lookup, so one reached by two ids is written in full twice, as
      // Jackson's identity is per instance.
      answer: (found: [string, DomainEntity][]) => new JsonMap(idKeyedMap(found)),
    },
  ].map(({ path, signature, answer }): Endpoint => ({
    path,
    method: 'post',
    sampleBody: 'R-HSA-1640170, R-HSA-109581, 199420\nREACT_578;xyz',
    differs: [
      new RegExp(`^${path}: \\.url: `),
      // The nested views' key order, which Java does not keep from one start to
      // the next: see /query/{id}.
      /^[^:]*(?=[^:]*includeRef=true)(?=[^:]*view=nested)[^:]*: \S*\.@(id|ref): /,
    ],
    /**
     * A batch of objects, by the ids in a text/plain body: split on , ;
     * newline and tab, trimmed; past twenty, the first twenty in a HashSet
     * (orthologyIds, which reads them as Java does). Each is findById, as
     * /query/{id} finds one, one at a time on the database the site shares.
     * None found is a 404 naming the ids as a Java list; a dbId past a long
     * anywhere is Java's 500 for the whole request.
     */
    handler: async (request) => {
      const contentType = request.get?.('content-type');
      const problem = plainTextProblem(contentType);
      if (problem) return javaError(request, 415, 'UNSUPPORTED_MEDIA_TYPE', problem);
      if (request.tooLarge)
        return javaError(request, 413, 'PAYLOAD_TOO_LARGE', 'More than 10MB of ids');
      if (!Buffer.isBuffer(request.body) || request.body.length === 0)
        return javaError(
          request,
          422,
          'UNPROCESSABLE_ENTITY',
          `Required request body is missing: ${signature}`
        );
      const ids = orthologyIds(plainText(request.body, contentType));
      const refused = findByIdFailure(ids);
      if (refused) return javaError(request, 500, 'INTERNAL_SERVER_ERROR', refused);
      const found: [string, DomainEntity][] = [];
      for (const id of ids) {
        const object = await findObject(id);
        if (object) found.push([id, object]);
      }
      if (found.length === 0)
        return notFound(request, `Ids: [${ids.join(', ')}] have not been found in the System`);
      return {
        status: 200,
        serialised: writeDomain(answer(found), ...writerFor(request)),
        type: 'application/json',
      };
    },
  })),
  {
    path: '/ContentService/data/diseases',
    /**
     * DiseasesController.getDiseases: every Disease, as graph-core's
     * SchemaRepository.getByClass reads a class -- the nodes alone, no
     * relationship, ordered by displayName -- written as the domain objects.
     */
    handler: async (request) => ({
      status: 200,
      serialised: writeDomain(mapNodes(await diseases()), ...writerFor(request)),
      type: 'application/json',
    }),
  },
  {
    path: '/ContentService/data/diseases/doid',
    // DiseasesController.getDiseasesSummary: one line a disease, its dbId,
    // then database:identifier -- Java's string concatenation, so a missing
    // one is "null".
    handler: async () => ({
      status: 200,
      type: 'text/plain;charset=UTF-8',
      body: (await diseases())
        .map(
          ({ props }) =>
            `${props.dbId}\t${props.databaseName ?? 'null'}:${props.identifier ?? 'null'}`
        )
        .join('\n'),
    }),
  },
  {
    path: '/ContentService/data/query/ids/map',
    // A GET here is Java's /query/{id}/{attributeName}, for an object called
    // "ids" -- which nothing is.
    handler: async (request) => notFound(request, 'Id: ids has not been found in the System'),
  },
  {
    path: '/ContentService/data/query/{id}/normalPathway',
    // A disease pathway, by stable id; the diff harness is given more forms.
    sample: 'R-HSA-6802957',
    // The 404 body names the service that answered; see /pathways/top/{id}.
    differs: [/^\/ContentService\/data\/query\/[^/]+\/normalPathway: \.url: /],
    /**
     * The normal pathway a disease pathway is drawn on, as one line of text.
     *
     * The Pathway Browser asks for this when a disease pathway has no diagram
     * of its own, then loads the normal pathway's diagram in its place. Java
     * serves it from the general `/data/query/{id}/{attributeName}`, as it does
     * stId: the object's getter, written by ControllerUtils.toTSV (see
     * databaseObjectTsv). Only Pathway and its subclasses have the getter, so
     * for anything else -- and for a pathway without one -- it is Java's 404
     * naming the object's class.
     */
    handler: async (request) => {
      const raw = pathId(rawSegment(request, 4));
      const { where, params } = resolveId(raw);
      const rows = await read<{
        labels: string[];
        dbId: number | null;
        stId: string | null;
        displayName: string | null;
        targetLabels: string[] | null;
      }>(
        `MATCH (n:DatabaseObject) WHERE ${where}
         OPTIONAL MATCH (n:Pathway)-[:normalPathway]->(m:DatabaseObject)
         RETURN labels(n) AS labels, m.dbId AS dbId, m.stId AS stId,
                m.displayName AS displayName, labels(m) AS targetLabels LIMIT 1`,
        params
      );
      const [row] = rows;
      if (!row) return notFound(request, `Id: ${raw} has not been found in the System`);
      if (row.dbId === null)
        return notFound(
          request,
          `Attribute: '${pathId(rawSegment(request, 5))}' has not been found for object: ${schemaClassOf(row.labels)}`
        );
      return {
        status: 200,
        body: databaseObjectTsv({
          dbId: row.dbId,
          stId: row.stId,
          displayName: row.displayName,
          schemaClass: schemaClassOf(row.targetLabels),
        }),
        type: 'text/plain;charset=UTF-8',
      };
    },
  },
  {
    // After every other /data/query/... route: Express takes them in order.
    path: '/ContentService/data/query/{id}/{attribute}',
    sample: 'R-HSA-109581',
    samplePath: { attribute: 'hasEvent' },
    differs: [/^\/ContentService\/data\/query\/[^/]+\/[^/]+: \.url: /],
    /**
     * One attribute of an object, as text: QueryObjectController.findById
     * (id, attributeName) -- the object as findById(id, OUTGOING) loads it
     * (findObject), its getter called by name ignoring case, and the value
     * written by ControllerUtils.toTSV (domain.ts: attributeGetter,
     * attributeValue, attributeText). A getter may load what the object did
     * not bring, as graph-core's LazyFetchAspect does (lazyRelationship).
     *
     * No object is Java's 404 naming the id; no getter, or one returning
     * nothing, its 404 naming the attribute and the object's class. Not
     * /query/abridged/{id}, /query/enhanced/{id} or /query/{id}/more, Java's
     * more specific mappings, which are no attribute: nginx and the dev proxy
     * never send those here.
     */
    handler: async (request) => {
      const raw = pathId(rawSegment(request, 4));
      const attribute = pathId(rawSegment(request, 5));
      if (raw === 'abridged' || raw === 'enhanced' || attribute === 'more')
        return springNotFound(request);
      const object = await findObject(raw);
      if (!object) return notFound(request, `Id: ${raw} has not been found in the System`);
      return attributeAnswer(request, object, attribute);
    },
  },
  {
    // Java's path variable is {identifier}; named {id} here so a dbId past a
    // long's range is Java's 500 naming it (failureAnswer).
    path: '/ContentService/data/discover/{id}',
    // Apoptosis: five creators, seven citations.
    sample: 'R-HSA-109581',
    // No `differs`: the Dataset's own `url` is content, and an error body's
    // is the only difference the sample never meets.
    /**
     * An event as a schema.org Dataset, for search engines: DiscoverController
     * over graph-core's DatabaseObjectService.findById and SchemaDataSet
     * (schemaDataSet).
     *
     * That findById is DatabaseObjectRepository's findByStId / findByDbId,
     * not the ordered findById(id, OUTGOING) of /query/{id}: every
     * relationship, both ways, unsorted, mapped as SDN maps any result
     * (mapResult). Its lists -- summations, references, the edits that
     * authored the event -- are in the order the store gives them; r.order,
     * relationship ids and a one-type expand each disagree with Java on some
     * event.
     *
     * Not found -- an object with no relationship included -- is Java's 404,
     * "{id} not found"; an object that is not an event is the 422 its
     * ClassCastException becomes, with a null message.
     */
    handler: async (request) => {
      const raw = pathId(rawSegment(request, 4));
      const missing = () => notFound(request, `${raw} not found`);
      const { where, params } = resolveId(raw);
      if (where === 'false') return missing();
      // What Java decides from the load below -- found, an event -- asked
      // first, alone. The load gathers every relationship of the object, and
      // for a species or a database that is hundreds of thousands, to answer
      // a 422; only an event is loaded.
      const [kind] = await read<{ labels: string[]; related: boolean }>(
        `MATCH (n:DatabaseObject) WHERE ${where}
         WITH n LIMIT 1
         RETURN labels(n) AS labels, EXISTS((n)--()) AS related`,
        params
      );
      if (!kind?.related) return missing();
      if (!isA(schemaClassOf(kind.labels), 'Event'))
        return javaError(request, 422, 'UNPROCESSABLE_ENTITY', null);
      // graph-core's findByStId / findByDbId, as written but for the id's
      // test: every relationship, both ways, in the order the store gives.
      const [row] = await read<MappedRow>(
        `MATCH (n:DatabaseObject) WHERE ${where}
         WITH n LIMIT 1
         MATCH (n)-[r]-(m)
         RETURN {id: id(n), labels: labels(n), props: properties(n)} AS root,
                COLLECT({id: id(r), type: type(r), start: id(startNode(r)),
                         end: id(endNode(r)), props: properties(r)}) AS relationships,
                COLLECT({id: id(m), labels: labels(m), props: properties(m)}) AS nodes`,
        params
      );
      // MATCH, not OPTIONAL MATCH: an object with no relationship at all is
      // not found, as in Java -- whatever its class.
      if (!row) return missing();
      if (!isA(schemaClassOf(row.root.labels), 'Event'))
        return javaError(request, 422, 'UNPROCESSABLE_ENTITY', null);
      const event = mapResult(row);
      const [info] = await read<{ version: number | null }>(
        'MATCH (n:DBInfo) RETURN n.releaseNumber AS version LIMIT 1'
      );
      return {
        status: 200,
        body: await schemaDataSet(
          {
            schemaClass: event.schemaClass,
            properties: event.properties,
            // Relationship fields: lists of mapped objects, when present.
            summations: ((event.fields['summation'] as DomainEntity[] | undefined) ?? []).map(
              (summation) => summation.fields['text']
            ),
            references: (
              (event.fields['literatureReference'] as DomainEntity[] | undefined) ?? []
            ).map((reference) => ({
              schemaClass: reference.schemaClass,
              ...reference.fields,
            })),
            authored: ((event.fields['authored'] as DomainEntity[] | undefined) ?? []).map(
              (edit) => edit.properties['dbId']
            ),
          },
          info?.version ?? null,
          lazyCollection
        ),
        type: 'application/json',
      };
    },
  },
  {
    path: '/ContentService/data/instance/{id}/referrers',
    // SchemaController.getInstanceReferrers, for the website's detail pages:
    // everything that points at the object -- not edit history, and, asked
    // about a species, compartment, database, evidence type or review
    // status, not everything that carries it -- grouped by relationship,
    // each a simple object (graph-core's ReferralsLinkageRepository
    // .getReferralsTo, at most 1000 groups). An id that is no identifier is
    // Java's 404; one nothing points at, [].
    handler: async (request) => {
      const raw = pathId(rawSegment(request, 4));
      const id = await graphCoreId(raw);
      if (!id) return notFound(request, `No referrers found for id: ${raw}`);
      const { params, byDbId } = id;
      // Long.parseLong past a long's range is Java's 500, naming the digits as
      // given.
      if (byDbId && BigInt(params.id) > 9223372036854775807n) {
        const digits = javaTrim(raw).split('.')[0];
        return javaError(request, 500, 'INTERNAL_SERVER_ERROR', `For input string: "${digits}"`);
      }
      const object = byDbId ? '{dbId:toInteger($id)}' : '{stId:$id}';
      const rows = await read<{
        referral: string;
        objects: {
          dbId: number;
          stId: string | null;
          displayName: string | null;
          schemaClass: string | null;
        }[];
      }>(
        `MATCH (d:DatabaseObject${object})<-[rel]-(ref)
         WHERE NOT ref:InstanceEdit
           AND NOT (d)<-[:species|compartment|includedLocation|referenceDatabase|evidenceType|reviewStatus|previousReviewStatus]-(ref)
         RETURN DISTINCT TYPE(rel) AS referral,
                COLLECT({dbId: ref.dbId, stId: ref.stId, displayName: ref.displayName, schemaClass: ref.schemaClass}) AS objects
         LIMIT 1000`,
        params
      );
      return {
        status: 200,
        type: 'application/json',
        body: rows.map((row): InstanceReferrals => ({
          referral: row.referral,
          // SimpleDatabaseObject.build(Value): on a collected node, its
          // schemaClass property, not its labels as from a Record.
          objects: row.objects.map((ref) => {
            const displayName = ref.displayName ?? 'null';
            const schemaClass = ref.schemaClass ?? 'null';
            const out: JsonWritten<SimpleDatabaseObject> = {
              dbId: ref.dbId,
              stId: ref.stId !== null && ref.stId !== '' ? ref.stId : undefined,
              displayName: displayName !== '' ? displayName : undefined,
              schemaClass: schemaClass !== '' ? schemaClass : undefined,
            };
            // javaJson leaves the undefined ones out, as non_empty does.
            return out as SimpleDatabaseObject;
          }),
        })),
      };
    },
  },
];
