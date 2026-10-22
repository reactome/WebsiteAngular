/**
 * The mapping and species endpoints (spec 014, research R1, a family): an
 * outside identifier's reactions and pathways (/data/mapping/*), reference
 * entities and their cross references (/references/*), orthology
 * (/data/ortholog*) and the species lists (/data/species/*), with the
 * helpers only they use. Moved unchanged from service.ts.
 */
import type { Endpoint, Request } from './endpoint.ts';
import type { GraphNode } from './graph.ts';
import { JavaHashMap } from './java-hashmap.ts';
import { inDepthId, longPastRange, pathwayJson, speciesFilter, speciesTaxId } from './objects.ts';
import { read } from './graph.ts';
import neo4j from 'neo4j-driver';
import {
  cached,
  compact,
  deepShare,
  javaError,
  javaJson,
  neo4jFailureMessage,
  notFound,
  only,
  timedOut,
} from './answers.ts';
import {
  pathId,
  queryValues,
  rawSegment,
  springIntWithDefault,
  springPathLong,
  writerFor,
} from './spring.ts';
import type { Props } from './objects.ts';
import type { Failure, Written } from './answers.ts';
import { orthologyIds, plainText, plainTextProblem } from './body.ts';
import { javaSplit, javaTrim } from './java-text.ts';
import { referenceEntityJson } from './reference-entities.ts';
import { JsonMap, mapNodes, writeDomain } from './domain.ts';

/**
 * getOrthologies' two HashMaps, given each id's orthologyOf: the service puts
 * every id that is an id (not null) -- found or not -- and the controller
 * keeps those found, iterating the first. How far the first grows decides
 * the second's order, so an id that is no id must not be put in it.
 */
export function orthologyMap(ids: string[], found: Map<string, GraphNode | null | undefined>) {
  const byId = new JavaHashMap<string, GraphNode | null | undefined>();
  for (const id of ids) if (found.get(id) !== null) byId.set(id, found.get(id));
  const kept = new JavaHashMap<string, GraphNode>();
  for (const [id, object] of byId.entries()) if (object) kept.set(id, object);
  return kept;
}

/** The reason Java's envelope gives with each status these endpoints send. */
const REASON = { 400: 'BAD_REQUEST', 500: 'INTERNAL_SERVER_ERROR' };

/**
 * graph-core's OrthologyRepository, as OrthologyService chooses between its
 * two queries: an object's counterparts in a species, inferred from it or it
 * from them (one step either way) or sharing the object they were both
 * inferred from (two steps). The Cypher is Java's, in a subquery so the
 * result comes back as a map; the first row is the one Java keeps.
 *
 * null when the id is no id (Java's null); undefined when nothing is found
 * (Java's empty list). A REACT_ id is the object whose oldStId it is, or, when
 * there is none, looked for as a stable id -- and not found, as in Java.
 */
async function orthologyOf(raw, species) {
  const id = inDepthId(raw);
  if (!id) return null;
  let { idType, id: value } = id;
  if (idType === 'oldStId') {
    const [old] = await read<{ stId: string | null }>(
      'MATCH (n:DatabaseObject) WHERE n.oldStId = $id RETURN n.stId AS stId LIMIT 1',
      { id: value }
    );
    value = old?.stId ?? value;
    idType = 'stId';
  }
  const anchor = idType === 'dbId' ? '{dbId:$id}' : '{stId:$id}';
  const rows = await read<{ o: GraphNode }>(
    `CALL {
       MATCH (:DatabaseObject${anchor})<-[:inferredTo]-()-[:inferredTo]->(o:DatabaseObject)-[:species]->(:Species{dbId:$speciesId}) RETURN DISTINCT o
       UNION
       MATCH (:DatabaseObject${anchor})-[:inferredTo]-(o:DatabaseObject)-[:species]->(:Species{dbId:$speciesId}) RETURN DISTINCT o
     }
     RETURN {id: id(o), labels: labels(o), props: properties(o)} AS o`,
    { id: idType === 'dbId' ? neo4j.int(value) : value, speciesId: neo4j.int(String(species)) }
  );
  return rows[0]?.o;
}

/**
 * A ReactionLikeEvent, of any class, as graph-core serialises the bare node:
 * Event's fields, then ReactionLikeEvent's, absent values omitted. Its
 * getClassName says "Reaction" whatever the class -- a BlackBoxEvent too --
 * and, overridden, Jackson writes it before schemaClass. Measured from Java's
 * /mapping answers over Reaction, BlackBoxEvent and FailedReaction.
 */
export function reactionLikeEventJson(node) {
  return {
    ...only(node, [
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
      'isChimeric',
      'systematicName',
      'category',
    ]),
    className: 'Reaction',
    ...only(node, ['schemaClass']),
  };
}

/** graph-core's MappingRepository: from an identifier in a resource to the entities made from it. */
const MAPPED_ENTITIES = `MATCH (n)-[:referenceDatabase]->(rd:ReferenceDatabase)
  WHERE toLower(rd.displayName) = toLower($databaseName)
    AND (n.identifier = $identifier OR n.variantIdentifier = $identifier OR $identifier IN n.geneName OR $identifier IN n.name)
  WITH DISTINCT n
  MATCH (pe:PhysicalEntity)-[:referenceEntity|referenceSequence|crossReference|referenceGene*]->(n)
  WITH DISTINCT pe`;

/** ...and up to every reaction any of them takes part in. */
const MAPPED_REACTION_ROLES =
  '[:input|output|catalystActivity|physicalEntity|entityFunctionalStatus|diseaseEntity|regulatedBy|regulator|hasComponent|hasMember|hasCandidate|repeatedUnit|proteinMarker|RNAMarker*]->(pe)';

/**
 * /mapping/{resource}/{identifier}/{reactions|pathways}, as MappingController
 * and graph-core's MappingService answer it; the queries are
 * MappingRepository's, kept as written (each orders by stId).
 *
 * - The species is read as SpeciesService reads it (speciesFilter). One it
 *   does not find is no filter dropped but nothing found: Java's 404.
 * - With no species parameter at all, a resource whose name contains
 *   "chebi", "compound" or "pubchem" is looked up in human (taxId 9606), as
 *   the controller's getSpecies decides; an empty one is no filter.
 * - For pathways, a resource that is "GO" in any case asks GO's own question:
 *   the pathways annotated with the biological process. An identifier that
 *   starts "go" in any case is first cut to its ASCII digits, as
 *   replaceAll("[^0-9]", "") does -- GO:0006915 is 0006915.
 * - An empty identifier, as the GO cut can leave, is nothing looked for --
 *   once the species has been looked up, as MappingService does.
 * - Nothing found is Java's 404, naming the resource and identifier as given.
 */
async function mappingAnswer(request: Request, kind) {
  const resource = pathId(rawSegment(request, 4));
  const identifier = pathId(rawSegment(request, 5));
  const given = queryValues(request, 'species');
  let species = given.length ? given.join(',') : undefined;
  if (species === undefined && /chebi|compound|pubchem/.test(resource.toLowerCase()))
    species = '9606';
  const missing = () => notFound(request, `No ${kind} found for ${resource}:${identifier}`);

  const go = kind === 'pathways' && resource.toLowerCase() === 'go';
  const asked =
    go && identifier.toLowerCase().startsWith('go')
      ? identifier.replace(/[^0-9]/g, '')
      : identifier;
  // MappingService looks the species up before it looks at the identifier,
  // so a species Java cannot read fails first even with nothing to look for.
  let taxId;
  if (species !== undefined && species !== '') {
    taxId = await speciesTaxId(speciesFilter(species));
    if (taxId === undefined) return missing();
  }
  if (asked === '') return missing();

  let cypher;
  let params;
  if (go) {
    cypher =
      taxId === undefined
        ? 'MATCH (p:Pathway)-[:goBiologicalProcess*]->(go:GO_BiologicalProcess) WHERE go.accession = $identifier RETURN DISTINCT p ORDER BY p.stId'
        : 'MATCH (p:Pathway)-[:goBiologicalProcess*]->(go:GO_BiologicalProcess) WHERE go.accession = $identifier WITH DISTINCT p MATCH (p)-[:species]->(:Species{taxId: $taxId}) RETURN p ORDER BY p.stId';
    params = { identifier: asked };
  } else {
    const inSpecies = taxId === undefined ? '' : '(:Species{taxId:$taxId})<-[:species]-';
    cypher =
      kind === 'reactions'
        ? `${MAPPED_ENTITIES}
           MATCH ${inSpecies}(rle:ReactionLikeEvent)-${MAPPED_REACTION_ROLES}
           RETURN DISTINCT rle ORDER BY rle.stId`
        : `${MAPPED_ENTITIES}
           MATCH (rle:ReactionLikeEvent)-${MAPPED_REACTION_ROLES}
           WITH DISTINCT rle
           MATCH ${inSpecies}(p:Pathway)-[:hasEvent]->(rle)
           RETURN DISTINCT p ORDER BY p.stId`;
    params = { databaseName: resource, identifier: asked };
  }
  const rows = await read<{ rle?: Props; p?: Props }>(cypher, {
    ...params,
    ...(taxId === undefined ? {} : { taxId }),
  });
  if (rows.length === 0) return missing();
  return {
    status: 200,
    body: rows.map((row) =>
      kind === 'reactions' ? reactionLikeEventJson(row.rle) : pathwayJson(row.p)
    ),
    type: 'application/json',
  };
}

/**
 * ReferenceEntityController's cross-reference query, with the identifier and
 * the database filter passed as parameters. Java writes them into the text
 * between double quotes, where a quote or a backslash is not itself: a quote
 * breaks Java's query (its 500), and a backslash begins an escape. Here they
 * are only ever values, looked up as written. For every identifier and
 * filter with neither, the query and its answer are Java's.
 */
export function crossReferenceQuery(dbFilter: string | undefined): string {
  const filter = dbFilter === undefined ? '' : 'WHERE xf.databaseName=$dbFilter ';
  return `MATCH (n{identifier:$identifier})<-[:crossReference]-(re:ReferenceEntity)-[:crossReference]->(xf) ${filter}OPTIONAL MATCH (re)<-[:referenceEntity]-(pe:PhysicalEntity) RETURN re.identifier as reference, [ x in collect(distinct xf) | {identifier:x.identifier, databaseName:x.databaseName, url:x.url}] as crossReferences, collect(distinct pe.stId) as physicalEntities`;
}

/** CrossReferenceResult.EMPTY: what an identifier that matches nothing is given. */
const NO_CROSS_REFERENCES = { reference: 'NO MATCH' };

/** The driver's Uncoercible: a value Value.asString cannot read as text. */
class Uncoercible extends Error {}

/**
 * Value.asString: a null is the text "null", text is itself, and anything
 * else -- a number, a boolean -- is the driver's Uncoercible, which only a
 * query the identifier or filter has rewritten can return.
 */
function javaAsString(value) {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'string') return value;
  const type =
    typeof value === 'boolean' ? 'BOOLEAN' : Number.isInteger(value) ? 'INTEGER' : 'FLOAT';
  throw new Uncoercible(`Cannot coerce ${type} to Java String`);
}

/**
 * ReferenceEntityController.getCrossReferenceResults: the rows of
 * crossReferenceQuery as CrossReferenceResult and ShortCrossReference build
 * them (every text through Value.asString), written with NON_EMPTY -- no
 * empty list or "" -- or [NO_CROSS_REFERENCES] when there are none.
 *
 * A query the database ended (its time limit, memory) is the service's 503,
 * as everywhere (timedOut). Any other Neo4j client error is Java's 500 as
 * Spring translates it, and a value that is not text the driver's
 * Uncoercible; both returned here as the answer to give.
 */
async function crossReferenceResults(request: Request, identifier, dbFilter) {
  try {
    const rows = await read<{
      reference: string | null;
      physicalEntities: (string | null)[];
      crossReferences: {
        identifier: string | null;
        databaseName: string | null;
        url: string | null;
      }[];
    }>(crossReferenceQuery(dbFilter), {
      identifier,
      ...(dbFilter === undefined ? {} : { dbFilter }),
    });
    if (rows.length === 0) return [NO_CROSS_REFERENCES];
    return rows.map((row) =>
      compact<Written>({
        reference: javaAsString(row.reference),
        physicalEntities: row.physicalEntities.map(javaAsString),
        crossReferences: row.crossReferences.map((reference) =>
          compact<Written>({
            identifier: javaAsString(reference.identifier),
            databaseName: javaAsString(reference.databaseName),
            url: javaAsString(reference.url),
          })
        ),
      })
    );
  } catch (caught) {
    const failure = caught as Failure | null | undefined;
    if (failure instanceof Uncoercible)
      return javaError(
        request,
        500,
        'INTERNAL_SERVER_ERROR',
        `${failure.message}; Error code 'N/A'; nested exception is org.neo4j.driver.exceptions.value.Uncoercible: ${failure.message}`
      );
    const ended = timedOut(request, failure);
    if (ended) return ended;
    const code = String(failure?.code ?? '');
    const message = code.startsWith('Neo.ClientError.')
      ? neo4jFailureMessage(failure, [code])
      : undefined;
    if (message) return javaError(request, 500, 'INTERNAL_SERVER_ERROR', message);
    throw caught;
  }
}

/**
 * Spring Data's PageImpl, as Jackson writes it with ContentService's
 * NON_EMPTY: the content (left out when empty), the PageRequest, then the
 * derived properties. The offset is a long -- page * size past 2^53 too, so
 * it is a BigInt and the answer is written by pageText. PageImpl corrects the
 * total when the slice runs past it: offset plus what the page holds.
 */
export function pageJson(content, page, size, total) {
  const offset = BigInt(page) * BigInt(size);
  const counted =
    content.length && offset + BigInt(size) > BigInt(total)
      ? Number(offset) + content.length
      : total;
  const totalPages = size === 0 ? 1 : Math.ceil(counted / size);
  const sort = { empty: true, sorted: false, unsorted: true };
  return {
    ...(content.length ? { content } : {}),
    pageable: { sort, offset, pageNumber: page, pageSize: size, paged: true, unpaged: false },
    // hasNext, in int arithmetic: the last possible page wraps round.
    last: !(((page + 1) | 0) < totalPages),
    totalPages,
    totalElements: counted,
    size,
    number: page,
    sort,
    first: page === 0,
    numberOfElements: content.length,
    empty: content.length === 0,
  };
}

/** pageJson's answer as Jackson writes it, its long offset as digits. */
export function pageText(page) {
  const marker = '\u0000long:';
  const text = javaJson({
    ...page,
    pageable: { ...page.pageable, offset: `${marker}${page.pageable.offset}` },
  });
  return text.replace(/"\\u0000long:(-?\d+)"/, '$1');
}

/** Batches of cross-reference lookups running at once (POST /references/mapping/xrefs). */
const BATCHES = deepShare(2);

/**
 * Each of `items` through `work`, at most `width` at a time, the answers in
 * the items' order -- or the first failure in that order, as a sequential
 * walk would meet it, the rest abandoned. A throw abandons the rest too, as
 * does `signal` (the client gone): no lookup starts once nobody will read
 * the answer.
 */
async function inOrderPool(items, width, work, signal?: AbortSignal) {
  const answers = new Array(items.length);
  let next = 0;
  let stopped = false;
  const worker = async () => {
    while (!stopped && !signal?.aborted && next < items.length) {
      const at = next++;
      try {
        answers[at] = await work(items[at]);
      } catch (caught) {
        stopped = true;
        throw caught;
      }
      if (answers[at]?.status) stopped = true;
    }
  };
  await Promise.all(Array.from({ length: Math.min(width, items.length) }, worker));
  return answers;
}

export const mappingSpeciesEndpoints: Endpoint[] = [
  ...[
    {
      suffix: 'main',
      /**
       * A species Reactome has curated pathways for, which is the list every
       * species selector on the site offers.
       *
       * "Main" is not a property on the node -- all 96 Species carry exactly the
       * same six -- it is a relationship: 16 of them are the target of at least
       * one TopLevelPathway's `species`, and 16 is what Java returns. Checked
       * against the graph rather than inferred from the count matching, because
       * two numbers agreeing is not a rule.
       */
      match: '(s:Species)<-[:species]-(:TopLevelPathway)',
    },
    { suffix: 'all', match: '(s:Species)' },
  ].map(({ suffix, match }): Endpoint => ({
    path: `/ContentService/data/species/${suffix}`,
    /**
     * The species lists, which differ in their order as well as their contents.
     *
     * `main` puts Homo sapiens first and sorts the rest by name; `all` is plain
     * alphabetical, human included, in its place. Both verified against the live
     * responses -- and the difference is the reason they are written as two rows
     * of one generator rather than one handler taking a flag, because a shared
     * sort would have quietly given `all` a pinned human or `main` an unpinned
     * one, and the page would still have rendered.
     *
     * Reactome pins human because it is the reference species everything else is
     * inferred from, so a selector that buries it between Gallus and Mus is
     * asking every reader to hunt for the common case.
     */
    handler: cached(`species/${suffix}`, async () => {
      const rows = await read<{ species: Props }>(
        `MATCH ${match}
         WITH DISTINCT s
         RETURN properties(s) AS species
         ORDER BY CASE WHEN s.displayName = 'Homo sapiens' THEN 0 ELSE 1 END, s.displayName`
      );
      const body = rows.map(({ species }) => ({
        ...only(species, ['dbId', 'displayName', 'name', 'taxId', 'abbreviation']),
        className: species.schemaClass,
        schemaClass: species.schemaClass,
      }));
      // `all` is alphabetical throughout, so the pin the query applies for
      // `main` is undone here rather than by a second query. One ORDER BY that
      // both share, and one line saying which of them does not want it.
      // Every species has a displayName (a string): only() copies what is there.
      const nameOf = (entry: Written) => entry['displayName'] as string;
      if (suffix === 'all') body.sort((a, b) => (nameOf(a) < nameOf(b) ? -1 : 1));
      return { status: 200, body, type: 'application/json' };
    }),
  })),
  {
    path: '/ContentService/data/mapping/{resource}/{identifier}/reactions',
    // TP53: 201 reactions, of three classes.
    samplePath: { resource: 'UniProt', identifier: 'P04637' },
    differs: [/^\/ContentService\/data\/mapping\/[^/]+\/[^/]+\/reactions(\?\S*)?: \.url: /],
    /**
     * The reactions an identifier in an outside resource takes part in, by
     * any role, optionally in one species. See mappingAnswer.
     */
    handler: (request) => mappingAnswer(request, 'reactions'),
  },
  {
    path: '/ContentService/data/mapping/{resource}/{identifier}/pathways',
    // TP53: the lower-level pathways of those reactions.
    samplePath: { resource: 'UniProt', identifier: 'P04637' },
    differs: [/^\/ContentService\/data\/mapping\/[^/]+\/[^/]+\/pathways(\?\S*)?: \.url: /],
    /**
     * The pathways those reactions are in; for GO, the pathways annotated
     * with a biological process. See mappingAnswer.
     */
    handler: (request) => mappingAnswer(request, 'pathways'),
  },
  {
    path: '/ContentService/references/mapping/xrefs',
    method: 'post',
    sampleBody: 'P36897, Q5S007',
    differs: [/^\/ContentService\/references\/mapping\/xrefs: \.url: /],
    /**
     * The cross references of a batch of identifiers, a page at a time:
     * ReferenceEntityController.getCrossReferencesForList. The text/plain
     * body is split on , ; newline and tab (String.split, so trailing empty
     * pieces go), and `page` and `pageSize` (ints, 0 and 100 by default)
     * choose the slice -- skip(page * pageSize) in long arithmetic (BigInt), then
     * limit(pageSize), each Java's 500 naming the number if negative. Each
     * identifier of the slice, trimmed, is one crossReferenceResults lookup,
     * written as {identifier: results}; the whole as Spring's PageImpl
     * (pageJson), counting every identifier sent. PageRequest's own checks
     * come last, after the lookups, as its arguments are evaluated last.
     */
    handler: async (request) => {
      const contentType = request.get?.('content-type');
      const problem = plainTextProblem(contentType);
      if (problem) return javaError(request, 415, 'UNSUPPORTED_MEDIA_TYPE', problem);
      const page = springIntWithDefault(queryValues(request, 'page'), 0);
      if (page.error !== undefined) return javaError(request, 400, 'BAD_REQUEST', page.error);
      const pageSize = springIntWithDefault(queryValues(request, 'pageSize'), 100);
      if (pageSize.error !== undefined)
        return javaError(request, 400, 'BAD_REQUEST', pageSize.error);
      if (request.tooLarge)
        return javaError(request, 413, 'PAYLOAD_TOO_LARGE', 'More than 10MB of ids');
      if (!Buffer.isBuffer(request.body) || request.body.length === 0)
        return javaError(
          request,
          422,
          'UNPROCESSABLE_ENTITY',
          'Required request body is missing: public org.springframework.data.domain.Page<java.util.Map<java.lang.String, java.util.Collection<org.reactome.server.service.controller.graph.util.CrossReferenceResult>>> org.reactome.server.service.controller.graph.ReferenceEntityController.getCrossReferencesForList(java.lang.String,int,int,java.lang.String)'
        );
      const given = queryValues(request, 'dbFilter');
      const dbFilter = given.length ? given.join(',') : undefined;
      const identifiers = javaSplit(plainText(request.body, contentType), /,|;|\n|\t/);
      // Stream.skip's long: page * pageSize past 2^53 is still exact.
      const skip = BigInt(page.value) * BigInt(pageSize.value);
      if (skip < 0n) return javaError(request, 500, 'INTERNAL_SERVER_ERROR', String(skip));
      if (pageSize.value < 0)
        return javaError(request, 500, 'INTERNAL_SERVER_ERROR', String(pageSize.value));
      const slice =
        skip >= BigInt(identifiers.length)
          ? []
          : identifiers.slice(Number(skip), Number(skip) + pageSize.value);
      // Java's parallel stream asks for several at once; each is a scan of
      // every node (the query names no label), so one at a time a full page
      // outlasts the proxy. Four at once, answers kept in order.
      const trimmed = slice.map(javaTrim);
      const gone = new AbortController();
      request.res?.on('close', () => {
        if (!request.res?.writableFinished) gone.abort();
      });
      // A page is one scan of every node per identifier (the query names no
      // label), four at a time, and a 10MB body holds millions: batches have
      // a share of their own, apart from the deep routes the site reads.
      if (!BATCHES.enter())
        return {
          ...javaError(
            request,
            503,
            'SERVICE_UNAVAILABLE',
            'The service is busy; try again shortly'
          ),
          headers: { 'Retry-After': '5' },
        };
      let answers;
      try {
        answers = await inOrderPool(
          trimmed,
          4,
          (identifier) => crossReferenceResults(request, identifier, dbFilter),
          gone.signal
        );
      } finally {
        BATCHES.leave();
      }
      // Nobody to answer: whatever is written goes nowhere.
      if (gone.signal.aborted) return { status: 500 };
      const failed = answers.find((results) => results?.status);
      if (failed) return failed;
      const content = trimmed.map((identifier, at) => ({ [identifier]: answers[at] }));
      if (page.value < 0)
        return javaError(
          request,
          500,
          'INTERNAL_SERVER_ERROR',
          'Page index must not be less than zero'
        );
      if (pageSize.value < 1)
        return javaError(
          request,
          500,
          'INTERNAL_SERVER_ERROR',
          'Page size must not be less than one'
        );
      return {
        status: 200,
        serialised: pageText(pageJson(content, page.value, pageSize.value, identifiers.length)),
        type: 'application/json',
      };
    },
  },
  {
    path: '/ContentService/references/mapping/{identifier}/xrefs',
    // TGFBR1: its cross references in a dozen resources, and its entities.
    samplePath: { identifier: 'P36897' },
    differs: [/^\/ContentService\/references\/mapping\/[^/]+\/xrefs(\?\S*)?: \.url: /],
    /**
     * The cross references and physical entities of the reference entities
     * an identifier names, optionally only those in one database (dbFilter):
     * ReferenceEntityController.getCrossReferencesFor. Nothing matching is
     * Java's 404. See crossReferenceResults.
     */
    handler: async (request) => {
      const identifier = pathId(rawSegment(request, 4));
      const given = queryValues(request, 'dbFilter');
      const results = await crossReferenceResults(
        request,
        identifier,
        given.length ? given.join(',') : undefined
      );
      if ('status' in results) return results;
      if (results.every((result) => result === NO_CROSS_REFERENCES))
        return notFound(
          request,
          `Identifier: ${identifier} has not been found as a cross reference in any of the annotated entities`
        );
      return { status: 200, body: results, type: 'application/json' };
    },
  },
  {
    path: '/ContentService/references/mapping/{identifier}',
    samplePath: { identifier: 'P36897' },
    differs: [/^\/ContentService\/references\/mapping\/[^/]+: \.url: /],
    /**
     * The reference entities behind every entity an identifier in any
     * resource names: graph-core's
     * ReferenceEntityRepository.getReferenceEntitiesFor, kept as written,
     * each written as graph-core serialises the node. None is Java's 404.
     */
    handler: async (request) => {
      const identifier = pathId(rawSegment(request, 4));
      const rows = await read<{ n: Props; labels: string[] }>(
        `MATCH (rd:ReferenceDatabase)<--(n{identifier:$identifier})<-[:referenceEntity|referenceSequence|crossReference|referenceGene*]-(pe:PhysicalEntity)
         WITH DISTINCT pe
         MATCH (pe)-[:referenceEntity]->(n:ReferenceEntity)
         RETURN DISTINCT n, labels(n) AS labels`,
        { identifier }
      );
      if (rows.length === 0)
        return notFound(
          request,
          `Identifier: ${identifier} has not been found as a cross reference in any of the annotated entities`
        );
      return {
        status: 200,
        body: rows.map((row) => referenceEntityJson(row.n, row.labels)),
        type: 'application/json',
      };
    },
  },
  {
    path: '/ContentService/data/orthology/{id}/species/{speciesId}',
    // A human pathway, in mouse; the diff harness is given more forms.
    sample: 'R-HSA-69620',
    samplePath: { speciesId: '48892' },
    // The error bodies name the service that answered; see /pathways/top/{id}.
    // '.' is not found here; Java's is a 500 (see resolveId).
    differs: [/^\/ContentService\/data\/orthology\/[^/]+\/species\/[^/]+: \.url: /],
    /**
     * An event's or entity's counterpart in another species: graph-core's
     * OrthologyService.getOrthology, the first object it finds, alone (no
     * relationships), written by the domain serialiser in Java's views. The
     * Pathway Browser asks when the species is changed with an event open.
     *
     * Java's answers: an id that is neither a stable id nor a dbId is a 404
     * naming it and the species; an id with no counterpart there is a 500 with
     * no message -- the controller takes the first of an empty list.
     */
    handler: async (request) => {
      const species = springPathLong(pathId(rawSegment(request, 6)), 'speciesId');
      if (species.error !== undefined)
        return javaError(request, species.status, REASON[species.status], species.error);
      const raw = pathId(rawSegment(request, 4));
      const refused = longPastRange([raw]);
      if (refused) return javaError(request, 500, 'INTERNAL_SERVER_ERROR', refused);
      const found = await orthologyOf(raw, species.value);
      if (found === null)
        return notFound(request, `No orthology found for '${raw}' in species '${species.value}'`);
      if (found === undefined) return javaError(request, 500, 'INTERNAL_SERVER_ERROR', null);
      return {
        status: 200,
        serialised: writeDomain(mapNodes([found])[0], ...writerFor(request)),
        type: 'application/json',
      };
    },
  },
  {
    path: '/ContentService/data/orthologies/ids/species/{speciesId}',
    method: 'post',
    samplePath: { speciesId: '48892' },
    // Two ids for one pathway, one with none and one that is no id.
    sampleBody: 'R-HSA-69620,R-HSA-69608;69620\nREACT_1538\txyz,R-ALL-29358',
    differs: [/^\/ContentService\/data\/orthologies\/ids\/species\/[^/]+: \.url: /],
    /**
     * OrthologyController.getOrthologies: the ids in a text/plain body, split
     * on , ; newline and tab and trimmed; past twenty, the first twenty in a
     * HashSet. Each id's first counterpart, as the GET above finds it, keyed
     * by the id as sent, in a HashMap -- written in that HashMap's order
     * (JavaHashMap), each value its own object. Ids with none are left out;
     * none at all is a 404. The Pathway Browser sends every id in its URL when
     * the species changes.
     *
     * Spring checks the content type first, then the species, then that there
     * is a body. A dbId past a long anywhere in the list is Java's 500 for the
     * whole request, as is '.' -- which here is an id with no counterpart, as
     * the GET reads it.
     */
    handler: async (request) => {
      const contentType = request.get?.('content-type');
      const problem = plainTextProblem(contentType);
      if (problem) return javaError(request, 415, 'UNSUPPORTED_MEDIA_TYPE', problem);
      const species = springPathLong(pathId(rawSegment(request, 6)), 'speciesId');
      if (species.error !== undefined)
        return javaError(request, species.status, REASON[species.status], species.error);
      if (request.tooLarge)
        return javaError(request, 413, 'PAYLOAD_TOO_LARGE', 'More than 10MB of ids');
      if (!Buffer.isBuffer(request.body) || request.body.length === 0)
        return javaError(
          request,
          422,
          'UNPROCESSABLE_ENTITY',
          'Required request body is missing: public java.util.Map<java.lang.Object, org.reactome.server.graph.domain.model.DatabaseObject> org.reactome.server.service.controller.graph.OrthologyController.getOrthologies(java.lang.Long,java.lang.String)'
        );
      const ids = orthologyIds(plainText(request.body, contentType));
      const refused = longPastRange(ids);
      if (refused) return javaError(request, 500, 'INTERNAL_SERVER_ERROR', refused);
      // One at a time, as Java asks, so twenty ids are not twenty queries at
      // once on the database the site shares.
      const found = new Map<string, GraphNode | null | undefined>();
      for (const id of ids) if (!found.has(id)) found.set(id, await orthologyOf(id, species.value));
      const kept = orthologyMap(ids, found);
      if (kept.size === 0) return notFound(request, 'No orthologies found');
      const entries = [...kept.entries()].map(([id, object]): [string, unknown] => [
        id,
        mapNodes([object])[0],
      ]);
      return {
        status: 200,
        serialised: writeDomain(new JsonMap(entries), ...writerFor(request)),
        type: 'application/json',
      };
    },
  },
];
