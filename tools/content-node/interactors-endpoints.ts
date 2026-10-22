/**
 * The interactor endpoints (spec 014, research R1, a family):
 * /interactors/*, the static (IntAct) and custom interactors and the
 * PSICQUIC resources -- the registry's list, read at start and every five
 * minutes -- with the helpers only they use. Moved unchanged from
 * service.ts.
 */
import type { Endpoint, Request } from './endpoint.ts';
import {
  pathId,
  queryValues,
  rawSegment,
  springBoolean,
  springIntegerWithDefault,
} from './spring.ts';
import {
  RawJson,
  javaError,
  neo4jFailureMessage,
  nonEmptyJson,
  notFound,
  unexpected,
} from './answers.ts';
import { read } from './graph.ts';
import neo4j from 'neo4j-driver';
import { caseInsensitive, javaSplit, javaTrim } from './java-text.ts';
import { JavaHashMap } from './java-hashmap.ts';
import { psicquicResources, registryServices } from './psicquic.ts';
import type { Failure, JsonWritten } from './answers.ts';
import type { PsicquicResource } from '../../projects/pathway-browser/src/app/interactors/model/interactor.model.ts';
import { settings } from './settings.ts';
import { plainIds, plainText, plainTextProblem } from './body.ts';
import type { Props } from './objects.ts';
import { pathwayJson } from './objects.ts';

/** An interaction and its partners (interactionsOf). */
type InteractionRow = {
  id: number;
  score: number;
  accession: string[] | null;
  url: string | null;
  partners: {
    labels: string[];
    identifier: string;
    variantIdentifier: string | null;
    url: string | null;
    geneName: string[] | null;
  }[];
};

/** /interactors/static/molecule/{id}/details: one interaction as a row. */
type CustomInteractionRow = {
  // null for an interaction without them: customInteractionJson fails as
  // Java's asLong()/asDouble() do.
  dbId: number | null;
  score: number | null;
  evidenceCount: number | null;
  identifier: string | null;
  databaseName: string | null;
  displayName: string | null;
  variantIdentifier: string | null;
  geneName: string[] | null;
  url: string | null;
  evidenceURL: string | null;
  speciesName: string | null;
  entitiesCount: number;
};

/** /interactors/static/molecule/{id}/withEntities: one interaction as a row. */
type InteractionWithEntitiesRow = {
  // null without an accession; written as 0, as Java's build() does.
  score: number | null;
  accession: string;
  accessionURL: string | null;
  physicalEntity: {
    dbId: number | null;
    stId: string | null;
    displayName: string | null;
    schemaClass: string | null;
  }[];
  evidences: number | null;
  url: string | null;
};

/**
 * The `page` and `pageSize` of the static details endpoints: Integers that
 * default to -1, paging only when neither is -1. A blank one is null, which
 * the service may fail on (pagingUnboxFails).
 */
function interactorPaging(request: Request) {
  const page = springIntegerWithDefault(queryValues(request, 'page'), -1);
  if (page.error !== undefined)
    return { answer: javaError(request, 400, 'BAD_REQUEST', page.error) };
  const pageSize = springIntegerWithDefault(queryValues(request, 'pageSize'), -1);
  if (pageSize.error !== undefined)
    return { answer: javaError(request, 400, 'BAD_REQUEST', pageSize.error) };
  return { page: page.value, pageSize: pageSize.value };
}

/**
 * Whether graph-core's getInteractions fails unboxing a null page or
 * pageSize: it reads page first, and pageSize only when page is not -1. It
 * runs once per accession, so a request with none never fails here.
 */
export function pagingUnboxFails({ page, pageSize }) {
  return page === null || (page !== -1 && pageSize === null);
}

/**
 * graph-core's InteractionsRepository.getByAcc, as written -- the plan, and so
 * the order of equal scores, is the query's -- with each interaction's partner
 * taken from its result. Every interaction has two interactors, the accession
 * and its partner, so the partner list holds one (the accession itself for a
 * homodimer). A negative SKIP or LIMIT is Java's 500 with Neo4j's message,
 * returned as `answer`.
 */
async function interactionsOf(request, acc, { page, pageSize }) {
  if (pagingUnboxFails({ page, pageSize })) return { answer: unexpected(request) };
  const paged = page !== -1 && pageSize !== -1;
  try {
    return await read<InteractionRow>(
      `CALL {
         MATCH (t:ReferenceEntity)<-[:interactor]-(in:Interaction)-[ir:interactor]->(re:ReferenceEntity) WHERE t.variantIdentifier = $acc OR (t.variantIdentifier IS NULL AND t.identifier = $acc) OPTIONAL MATCH (pe:PhysicalEntity)-[r:referenceEntity]->(re) RETURN DISTINCT in, COLLECT(DISTINCT ir) AS irs, COLLECT(DISTINCT re) AS res, COLLECT(DISTINCT r) AS rs, COLLECT(DISTINCT pe)[..20] AS pe ORDER BY in.score DESC${paged ? ' SKIP ($page - 1) * $pageSize LIMIT $pageSize' : ''}
       }
       RETURN in.dbId AS id, in.score AS score, in.accession AS accession, in.url AS url,
              [x IN res | {labels: labels(x), identifier: x.identifier,
                           variantIdentifier: x.variantIdentifier, url: x.url,
                           geneName: x.geneName}] AS partners`,
      { acc, ...(paged && { page: neo4j.int(page), pageSize: neo4j.int(pageSize) }) }
    );
  } catch (failure) {
    const message = neo4jFailureMessage(failure);
    if (message === undefined) throw failure;
    return { answer: javaError(request, 500, 'INTERNAL_SERVER_ERROR', message) };
  }
}

/**
 * The content service's Interactor, from one interactionsOf row: the partner's
 * variant identifier if it is an isoform with one, else its identifier; its
 * first gene name as the alias; the evidence count, score and URLs.
 */
export function interactorJson(row) {
  const [partner = {}] = row.partners;
  const isoform = partner.labels?.includes('ReferenceIsoform');
  const acc = isoform && partner.variantIdentifier ? partner.variantIdentifier : partner.identifier;
  const alias = partner.labels?.includes('ReferenceSequence') ? partner.geneName?.[0] : undefined;
  return nonEmptyJson([
    ['acc', acc],
    ['alias', alias],
    ['id', row.id],
    ['evidences', row.accession?.length],
    ['score', row.score, true],
    ['accURL', partner.url],
    ['evidencesURL', row.url],
  ]);
}

/**
 * The content service's Interactors: `static`, and an entry for each
 * accession -- its interactors' count, and the list, left out when empty.
 */
export function interactorsJson(entities) {
  const written = entities.map(([acc, rows]) =>
    nonEmptyJson([
      ['acc', acc],
      ['count', rows.length],
      ['interactors', rows.length ? new RawJson(`[${rows.map(interactorJson).join(',')}]`) : []],
    ])
  );
  return `{"resource":"static","entities":[${written.join(',')}]}`;
}

/**
 * graph-core's CustomInteraction, a row of its query, in field order, as its
 * Record constructor reads it: asString() writes a missing value as the text
 * "null"; speciesName and variantIdentifier are asString(null); a missing
 * geneName is an empty list. A missing dbId, score or evidenceCount fails
 * asLong() or asDouble(): undefined, the service's failure.
 */
export function customInteractionJson(row) {
  if ([row.dbId, row.score, row.evidenceCount].some((value) => value === null)) return undefined;
  const text = (value) => value ?? 'null';
  return nonEmptyJson([
    ['dbId', row.dbId],
    ['identifier', text(row.identifier)],
    ['score', row.score, true],
    ['evidenceCount', row.evidenceCount],
    ['url', text(row.url)],
    ['evidenceURL', text(row.evidenceURL)],
    ['geneName', row.geneName],
    ['databaseName', text(row.databaseName)],
    ['entitiesCount', row.entitiesCount],
    ['speciesName', row.speciesName],
    ['displayName', text(row.displayName)],
    ['variantIdentifier', row.variantIdentifier],
  ]);
}

/**
 * The content service's InteractionWithEntities, a row of its query, as
 * build() reads it -- score and evidences as 0 when missing -- with the
 * entities sorted by name as String.CASE_INSENSITIVE_ORDER sorts (stably).
 * Each entity is a SimpleDatabaseObject built from a map: stId asString(null),
 * displayName and schemaClass asString(), which writes a missing one "null".
 */
export function interactionWithEntitiesJson(row) {
  const entities = (row.physicalEntity ?? [])
    .map((pe) => ({ ...pe, displayName: pe.displayName ?? 'null' }))
    // A graph displayName, or 'null' (above): a string either way.
    .sort((a, b) => caseInsensitive(a.displayName as string, b.displayName as string));
  const written = entities.map((pe) =>
    nonEmptyJson([
      ['dbId', pe.dbId],
      ['stId', pe.stId],
      ['displayName', pe.displayName],
      ['schemaClass', pe.schemaClass ?? 'null'],
    ])
  );
  return nonEmptyJson([
    ['score', row.score ?? 0, true],
    ['accession', row.accession],
    ['accessionURL', row.accessionURL],
    ['physicalEntity', written.length ? new RawJson(`[${written.join(',')}]`) : []],
    ['evidences', row.evidences ?? 0],
    ['url', row.url],
  ]);
}

/**
 * InteractionManager.getStaticProteinsSummary: graph-core's
 * InteractorCountRepository.countByAccessions, kept as written, gathered by
 * InteractionsService into a HashMap keyed by the reference entity's
 * identifier -- an isoform's accession counts under its protein's -- and
 * written in that map's order as Interactors of InteractorEntity (acc,
 * count), each with a count above nothing.
 */
async function staticSummary(accs) {
  const rows = await read<{ s: string; t: number }>(
    `MATCH (t:ReferenceEntity)<-[:interactor]-(in:Interaction)
     WHERE t.variantIdentifier IN $accs OR (t.variantIdentifier IS NULL AND t.identifier IN $accs)
     RETURN DISTINCT t.identifier AS s, COUNT(DISTINCT in) as t`,
    { accs }
  );
  const counts = new JavaHashMap<string, number>();
  for (const row of rows) counts.set(row.s, Number(row.t));
  const entities = [...counts.entries()]
    .filter(([, count]) => count > 0)
    .map(([acc, count]) => ({ acc: javaTrim(acc), count }));
  return { resource: 'static', entities };
}

/** The PSICQUIC resources as last read, written; null before a reading, or after one failed. */
let psicquicCache: string | null = null;

/** A PsicquicResource as content-service's NON_EMPTY mapper writes it. */
export function resourcesJson(resources: ReturnType<typeof psicquicResources>) {
  return `[${resources
    .map((r) => {
      // The site's PsicquicResource, field for field; nonEmptyJson leaves out
      // an absent URL, as non_empty does.
      const resource: JsonWritten<PsicquicResource> = {
        name: r.name,
        soapURL: r.soapUrl ?? undefined,
        restURL: r.restUrl ?? undefined,
        active: r.active,
      };
      return nonEmptyJson(Object.entries(resource));
    })
    .join(',')}]`;
}

/**
 * PsicquicResourceCachingScheduler's one pass: read the registry and keep the
 * list, or keep nothing when the reading fails -- so the endpoint answers
 * Java's 500 until a reading succeeds. content-service runs it every five
 * minutes from start-up; so does this service when started (not when a test
 * imports it).
 */
export async function refreshPsicquicResources({ timeout = 60_000 } = {}) {
  let registry = settings.psicquicRegistryUrl();
  // The registry client adds the slash a base URL lacks.
  if (!registry.endsWith('/')) registry += '/';
  try {
    const response = await fetch(`${registry}registry?action=STATUS&format=xml`, {
      signal: AbortSignal.timeout(timeout),
    });
    // HttpURLConnection's openStream refuses 400 and above.
    if (response.status >= 400) {
      await response.body?.cancel();
      throw new Error(`registry answered ${response.status}`);
    }
    psicquicCache = resourcesJson(psicquicResources(registryServices(await response.text())));
  } catch (caught) {
    const failure = caught as Failure;
    if (failure instanceof ReferenceError) throw failure;
    // Java's reading has no timeout: a registry that does not answer leaves
    // it waiting, and the list it had in place. So does this, until the next.
    if (failure.name === 'TimeoutError') {
      console.error('PSICQUIC resources: the registry did not answer; the last list stands');
      return;
    }
    psicquicCache = null;
    console.error(`PSICQUIC resources: ${failure.message}`);
  }
}

export const interactorsEndpoints: Endpoint[] = [
  {
    path: '/ContentService/interactors/static/molecule/{id}/details',
    sample: 'P04637',
    differs: [/: \.url: /],
    /**
     * An accession's interactors from IntAct, as the Pathway Browser's entity
     * popup lists them: graph-core's InteractionsRepository.getByAcc, paged
     * when `page` and `pageSize` are both given, each interaction written as
     * the content service's Interactor (interactorsJson).
     */
    handler: async (request) => {
      const acc = pathId(rawSegment(request, 5));
      const window = interactorPaging(request);
      if (window.answer) return window.answer;
      const rows = await interactionsOf(request, acc, window);
      if ('answer' in rows) return rows.answer;
      // getAccession().size() on an interaction with none.
      if (rows.some((row) => row.accession === null)) return unexpected(request);
      if (rows.length === 0) return notFound(request, `No interactors found for accession: ${acc}`);
      return { status: 200, body: interactorsJson([[acc, rows]]), type: 'application/json' };
    },
  },
  {
    path: '/ContentService/interactors/static/molecule/{id}/summary',
    // TP53: 249 interactors.
    sample: 'P04637',
    differs: [/: \.url: /],
    /**
     * How many IntAct interactors an accession has: the Pathway Browser's
     * interactor counts. See staticSummary. None is Java's 404 naming the
     * accession as given.
     */
    handler: async (request) => {
      const acc = pathId(rawSegment(request, 5));
      const summary = await staticSummary([acc]);
      if (!summary.entities.length)
        return notFound(request, `No interactors found for accession: ${acc}`);
      return { status: 200, body: summary, type: 'application/json' };
    },
  },
  {
    path: '/ContentService/interactors/static/molecules/summary',
    method: 'post',
    sampleBody: 'P04637, Q00987;xyz',
    differs: [/: \.url: /],
    /**
     * How many interactors each of a batch of accessions has: the body split
     * on , ; newline and tab and each piece trimmed, then staticSummary. None
     * is Java's 404 naming the body as sent.
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
          'Required request body is missing: public org.reactome.server.service.model.interactors.Interactors org.reactome.server.service.controller.interactors.StaticInteractionsController.getProteinsSummaryByAccs(java.lang.String)'
        );
      const body = plainText(request.body, contentType);
      const summary = await staticSummary(javaSplit(body, /,|;|\n|\t/).map(javaTrim));
      if (!summary.entities.length)
        return notFound(request, `No interactors found for accession: ${body}`);
      return { status: 200, body: summary, type: 'application/json' };
    },
  },
  {
    path: '/ContentService/interactors/static/molecule/{id}/pathways',
    // TP53's interactors, in human pathways.
    sample: 'P04637?species=Homo%20sapiens',
    differs: [/: \.url: /],
    /**
     * The lower-level pathways an accession's interactors take part in, in
     * one species: graph-core's PathwayRepository.getLowerLevelPathways, or
     * getDiagrammedLowerLevelPathways with onlyDiagrammed (a Boolean, false
     * by default), kept as written. The species is compared with the
     * pathways' speciesName as given -- "Homo sapiens", not a taxId -- and
     * none at all is null, which matches nothing: Java's 404.
     */
    handler: async (request) => {
      const acc = pathId(rawSegment(request, 5));
      const given = queryValues(request, 'species');
      const speciesName = given.length ? given.join(',') : null;
      const diagrammed = springBoolean(queryValues(request, 'onlyDiagrammed'));
      if (diagrammed.error !== undefined)
        return javaError(request, 400, 'BAD_REQUEST', diagrammed.error);
      const rows = await read<{ p: Props }>(
        diagrammed.value
          ? `MATCH (a:ReferenceEntity)<-[:interactor]-()-[:interactor]->(b:ReferenceEntity)
             WHERE a.identifier = $acc OR a.variantIdentifier = $acc
             MATCH path=(p:Pathway{hasDiagram:True})-[:hasEvent|input|output|catalystActivity|physicalEntity|regulatedBy|regulator*]->(pe:PhysicalEntity)-[:referenceEntity]->(b)
             WHERE p.speciesName = $speciesName AND SINGLE(e IN NODES(path) WHERE (e:Pathway) AND e.hasDiagram)
             RETURN DISTINCT p`
          : `MATCH (a:ReferenceEntity)<-[:interactor]-()-[:interactor]->(b:ReferenceEntity)
             WHERE a.identifier = $acc OR a.variantIdentifier = $acc
             MATCH path=(p:Pathway)-[:hasEvent|input|output|catalystActivity|physicalEntity|regulatedBy|regulator*]->(pe:PhysicalEntity)-[:referenceEntity]->(b)
             WHERE p.speciesName = $speciesName AND SINGLE(e IN NODES(path) WHERE (e:Pathway))
             RETURN DISTINCT p`,
        { acc, speciesName }
      );
      if (rows.length === 0) return notFound(request, `No pathways found for molecule: ${acc}`);
      return { status: 200, body: rows.map((row) => pathwayJson(row.p)), type: 'application/json' };
    },
  },
  {
    path: '/ContentService/interactors/psicquic/resources',
    // PsicquicInteractionsController.getResources: the PSICQUIC services the
    // Pathway Browser can draw interactors from, from the last reading of the
    // registry (refreshPsicquicResources); Java's 500 when there is none.
    handler: async (request) =>
      psicquicCache === null
        ? javaError(request, 500, 'INTERNAL_SERVER_ERROR', "Couldn't load PSICQUIC Resources")
        : { status: 200, type: 'application/json', body: psicquicCache },
  },
  {
    path: '/ContentService/interactors/static/molecules/details',
    method: 'post',
    sampleBody: 'P04637,Q00987, P38398\nXYZ',
    differs: [/: \.url: /],
    /**
     * Interactors for many accessions, which the Pathway Browser asks for every
     * protein in a diagram when the static resource is chosen: the body split
     * and trimmed into a HashSet (its order is the answer's), each accession
     * as the GET above, one at a time as Java asks. One with none is still an
     * entry, with its count; none for any is a 404 naming the body as sent.
     */
    handler: async (request) => {
      const contentType = request.get?.('content-type');
      const problem = plainTextProblem(contentType);
      if (problem) return javaError(request, 415, 'UNSUPPORTED_MEDIA_TYPE', problem);
      const window = interactorPaging(request);
      if (window.answer) return window.answer;
      if (request.tooLarge)
        return javaError(request, 413, 'PAYLOAD_TOO_LARGE', 'More than 10MB of accessions');
      if (!Buffer.isBuffer(request.body) || request.body.length === 0)
        return javaError(
          request,
          422,
          'UNPROCESSABLE_ENTITY',
          'Required request body is missing: public org.reactome.server.service.model.interactors.Interactors org.reactome.server.service.controller.interactors.StaticInteractionsController.getProteinsDetailsByAccs(java.lang.Integer,java.lang.Integer,java.lang.String)'
        );
      const proteins = plainText(request.body, contentType);
      const accs = new JavaHashMap();
      for (const acc of plainIds(proteins)) accs.set(acc, true);
      const entities: [string, unknown[]][] = [];
      for (const acc of accs.keys()) {
        const rows = await interactionsOf(request, acc, window);
        if ('answer' in rows) return rows.answer;
        if (rows.some((row) => row.accession === null)) return unexpected(request);
        entities.push([acc, rows]);
      }
      if (entities.every(([, rows]) => rows.length === 0))
        return notFound(request, `No interactors found for accession: ${proteins}`);
      return { status: 200, body: interactorsJson(entities), type: 'application/json' };
    },
  },
  {
    path: '/ContentService/interactors/static/molecule/enhanced/{id}/details',
    sample: 'P04637',
    /**
     * The same interactions with more about each partner, for the website's
     * and the Pathway Browser's interactor tables: graph-core's
     * CustomInteractionsRepository, as written, each row a CustomInteraction.
     * None is `[]`, not a 404: the controller only refuses a null.
     */
    handler: async (request) => {
      const acc = pathId(rawSegment(request, 6));
      const rows = await read<CustomInteractionRow>(
        `MATCH (t:ReferenceEntity)<-[:interactor]-(in:Interaction)-[ir:interactor]->(re:ReferenceEntity) WHERE t.variantIdentifier = $identifier OR (t.variantIdentifier IS NULL AND t.identifier = $identifier) OPTIONAL MATCH (pe:PhysicalEntity)-[r:referenceEntity]->(re) OPTIONAL MATCH (se:Species)<-[s:species]-(re) WITH in, re, se, pe, t ORDER BY in.score DESC RETURN DISTINCT in.dbId AS dbId, in.score AS score, SIZE(in.accession) AS evidenceCount, re.identifier AS identifier, re.databaseName AS databaseName, re.displayName AS displayName, re.variantIdentifier as variantIdentifier, re.geneName AS geneName, re.url as url, in.url AS evidenceURL,  se.displayName AS speciesName, COUNT(pe) AS entitiesCount`,
        { identifier: acc }
      );
      const written = rows.map(customInteractionJson);
      if (written.includes(undefined)) return unexpected(request);
      return { status: 200, body: `[${written.join(',')}]`, type: 'application/json' };
    },
  },
  {
    path: '/ContentService/interactors/static/molecule/{id}/withEntities',
    sample: 'P04637',
    differs: [/: \.url: /],
    /**
     * Each interaction with the Reactome entities its partner is, for the
     * website's interactor page: the content service's own query, as written,
     * each row an InteractionWithEntities.
     */
    handler: async (request) => {
      const acc = pathId(rawSegment(request, 5));
      const rows = await read<InteractionWithEntitiesRow>(
        'MATCH (s:ReferenceEntity)<-[:interactor]-(it:Interaction),       (it)-[ir:interactor]->(in:ReferenceEntity)<-[re:referenceEntity]-(pe:PhysicalEntity),       (:ReactionLikeEvent)-[:input|output|catalystActivity|physicalEntity|entityFunctionalStatus|diseaseEntity|regulatedBy|regulator*]->(pe) WHERE s.variantIdentifier = $accession OR (s.variantIdentifier IS NULL AND s.identifier = $accession) RETURN DISTINCT it.score AS score, in.identifier AS accession, in.url AS accessionURL,                 COLLECT(DISTINCT{                          dbId: pe.dbId,                          stId: pe.stId,                          displayName: pe.displayName,                          schemaClass: pe.schemaClass                 }) AS physicalEntity,                 SIZE(it.accession) AS evidences,                 it.url AS url ORDER BY score DESC, accession',
        { accession: acc }
      );
      if (rows.length === 0) return notFound(request, `No interactors found for accession: ${acc}`);
      return {
        status: 200,
        body: `[${rows.map(interactionWithEntitiesJson).join(',')}]`,
        type: 'application/json',
      };
    },
  },
];
