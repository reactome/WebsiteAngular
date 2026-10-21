/**
 * The content service, in node.
 *
 * A gradual replacement for the Java ContentService's read surface. It exposes
 * the same paths under the same shapes, one endpoint at a time, and every one is
 * proven against the Java implementation by `diff.ts` before it is switched on
 * in `proxy.conf.js`.
 *
 * Deliberately not a rewrite in one go, and deliberately not the exporters:
 * SBML, SBGN and the PDF document come from Java libraries that carry those
 * specifications, and reimplementing them is a research project rather than a
 * port. Diagram figures already come from our own renderer.
 *
 *   NEO4J_USER=... NEO4J_PASSWORD=... npm run content:node
 *
 * Nothing points at it until a path is listed in proxy.conf.js, so running it
 * cannot affect the site.
 */
import express from 'express';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { setInterval } from 'node:timers';
import { readFileSync, readdirSync, realpathSync } from 'node:fs';
import { fileURLToPath, URLSearchParams } from 'node:url';
import { read, configured, close } from './graph.ts';
import { settings } from './settings.ts';
import type { MappedRow } from './domain.ts';
import type { Endpoint } from './endpoint.ts';
import type {
  DiagramFlagResult,
  SpeciesOverviewFlagResult,
} from '../../projects/pathway-browser/src/app/model/flag.model.ts';

import { defaultLabel, label, redirectLabel, setLabel } from './cache-label.ts';
import { solr, solrConfigured } from './solr.ts';
import type { SolrAnswer, SolrGrouping } from './solr.ts';

import { JavaHashMap } from './java-hashmap.ts';

export { JavaHashMap };

import { inDepthQuery, mapResult, writeDomain } from './domain.ts';

import {
  asciiDigits,
  hashSetOf,
  javaNumeric,
  javaSplit,
  javaTrim,
  javaTrimAll,
  present,
} from './java-text.ts';
import {
  pathId,
  queryValues,
  rawSegment,
  requiredString,
  springBoolean,
  springEnum,
  springIntWithDefault,
  springInteger,
  springIntegerWithDefault,
  springList,
  springPathLong,
  springScope,
  writerFor,
} from './spring.ts';
import type { Bound } from './spring.ts';
import {
  deepShare,
  javaError,
  javaJson,
  notFound,
  springNotFound,
  timedOut,
  unexpected,
  unexpectedFailure,
} from './answers.ts';
import type { Failure, JsonWritten, Written } from './answers.ts';
import { inDepthId, longPastRange, resolveId } from './objects.ts';

import { PARSER_TYPES, SCOPE_FILTER, pair, searchParams, springFields } from './search-params.ts';
import type { SolrParams } from './search-params.ts';
import { databaseVersion } from './release.ts';
import { citationEndpoints } from './citation-endpoints.ts';
import { contentEndpoints } from './content-endpoints.ts';
import { personEndpoints } from './person-endpoints.ts';
import { schemaEndpoints } from './schema-endpoints.ts';
import { interactorsEndpoints, refreshPsicquicResources } from './interactors-endpoints.ts';
import { exportersEndpoints } from './exporters-endpoints.ts';
import { entitiesEndpoints } from './entities-endpoints.ts';
import { mappingSpeciesEndpoints } from './mapping-species-endpoints.ts';
import { dataQueryEndpoints } from './data-query-endpoints.ts';
import { pathwaysEventsEndpoints } from './pathways-events-endpoints.ts';
import {
  OCCURRENCE_READS,
  blankBoolean,
  facetContainer,
  fourParts,
  fromSolr,
  rawOccurrence,
  reportInformation,
  reportNotFound,
  searchEntry,
  solrStrings,
  solrValue,
  targetsOf,
} from './search-core.ts';
import type { FacetContainer, TargetResult } from './search-core.ts';

// Node 24 has JSON.rawJSON (ES2025); TypeScript 5.9's libraries do not yet.
declare global {
  interface JSON {
    rawJSON(text: string): unknown;
  }
}

const PORT = settings.port();
const HOST = settings.host();

/**
 * The endpoints implemented so far, in the order they were ported.
 *
 * Each entry is the path the Java service uses, so the diff harness and the
 * proxy table can both address them by that one string.
 */
export const endpoints: Endpoint[] = [
  ...dataQueryEndpoints,
  ...pathwaysEventsEndpoints,
  ...contentEndpoints,
  ...personEndpoints,
  ...mappingSpeciesEndpoints,
  ...[
    {
      kind: 'entity',
      label: 'PhysicalEntity',
      follow: 'hasComponent|hasMember|hasCandidate|repeatedUnit|proteinMarker|RNAMarker',
      // A complex of a complex, so there is more than one level to follow.
      sample: 'R-HSA-109796?includeRef=true&view=nested-aggregated',
    },
    {
      kind: 'event',
      label: 'Event',
      follow: 'hasEvent',
      sample: 'R-HSA-69620?includeRef=true&view=nested-aggregated',
    },
  ].map(({ kind, label, follow, sample }): Endpoint => ({
    path: `/ContentService/data/${kind}/{id}/in-depth`,
    // A whole tree below an object: may run for the full read timeout.
    deep: true,
    sample,
    differs: [
      // The 404 body names the service that answered; see /pathways/top/{id}.
      new RegExp(`^/ContentService/data/${kind}/[^/]+/in-depth[^:]*: \\.url: `),
      // An `attributes` that is not relationship type names: Java writes it
      // into its query and answers Neo4j's syntax error; node refuses it before
      // any query, with a message of its own.
      new RegExp(`^/ContentService/data/${kind}/[^/]+/in-depth[^:]*: \\.messages\\[0\\]: `),
    ],
    /**
     * An entity or an event and everything below it -- the Pathway Browser's
     * object tree and details panel read them -- as graph-core's
     * getPhysicalEntityInDepth / getEventInDepth: every path from it along
     * its structure (`follow`) up to `maxDepth` steps, each node with
     * its `attributes` relationships, written by the domain serialiser in the
     * view the request asks for (the site asks nested-aggregated with JSOG).
     *
     * As Java: `maxDepth` (default 1) of 0 means 1 and below 0 means no limit;
     * `attributes` (default species,compartment) is split on commas, trailing
     * empties dropped, and an empty list means species. An id is read as
     * graph-core's getIdentifier reads it (inDepthId). With no path below it
     * there is no answer at all: an entity
     * is Java's empty 200, an event its 404.
     */
    handler: async (request) => {
      const raw = pathId(rawSegment(request, 4));
      const depth = springIntWithDefault(queryValues(request, 'maxDepth'), 1);
      if (depth.error !== undefined) return javaError(request, 400, 'BAD_REQUEST', depth.error);
      const attributes = inDepthAttributes(queryValues(request, 'attributes'));
      if (attributes.error !== undefined)
        return javaError(request, 500, 'INTERNAL_SERVER_ERROR', attributes.error);
      const id = inDepthId(raw);
      const none =
        kind === 'entity'
          ? { status: 200, body: undefined }
          : notFound(request, `No event found for given identifier: ${raw}`);
      if (!id) return none;
      const maxDepth = depth.value === 0 ? 1 : depth.value < 0 ? 2147483647 : depth.value;
      const [row] = await read<MappedRow>(
        inDepthQuery({ label, follow, idType: id.idType, maxDepth, attributes: attributes.value }),
        { id: id.id }
      );
      if (!row) return none;
      return {
        status: 200,
        serialised: writeDomain(mapResult(row), ...writerFor(request)),
        type: 'application/json',
      };
    },
  })),
  ...entitiesEndpoints,
  ...schemaEndpoints,
  ...interactorsEndpoints,
  ...exportersEndpoints,
  ...['suggest', 'spellcheck'].map((handler): Endpoint => ({
    path: `/ContentService/search/${handler}`,
    // Search-core's getAutocompleteSuggestions / getSpellcheckSuggestions:
    // the collations Solr's own /suggest or /spellcheck handler offers for
    // `query`, each kept only if /exists finds it in the index. What is
    // offered, in what order and how many is solrconfig.xml's, as for Java.
    // An empty query is Java's null: a 200 with no body and no type.
    handler: async (request) => {
      const given = queryValues(request, 'query');
      if (given.length === 0)
        return javaError(
          request,
          400,
          'BAD_REQUEST',
          "Required request parameter 'query' for method parameter type String is not present"
        );
      const query = given.join(',');
      if (query === '') return { status: 200 };
      return fromSolr(request, `/ContentService/search/${handler}`, async (signal) => ({
        status: 200,
        type: 'application/json',
        body: await suggestionsFrom(`/${handler}`, query, solr, signal),
      }));
    },
  })),
  {
    path: '/ContentService/search/facet',
    // SearchService.getTotalFacetingInformation: every document's facets,
    // counted by Solr's /facetall handler over the reference-entity scope.
    // The search page asks for it before anything is searched.
    handler: (request) =>
      fromSolr(request, '/ContentService/search/facet', async (signal) =>
        facetAnswer(
          await solr(
            '/facetall',
            [
              ['q', '*:*'],
              ['fq', 'hasReferenceEntity:false'],
            ],
            { signal }
          )
        )
      ),
  },
  {
    path: '/ContentService/search/facet_query',
    // SearchController.facet_type: the facets of a query, filtered by the
    // species, types, keywords and compartments given, in a scope. The
    // search page asks for it with every search.
    handler: (request) => {
      const given = queryValues(request, 'query');
      if (given.length === 0)
        return javaError(
          request,
          400,
          'BAD_REQUEST',
          "Required request parameter 'query' for method parameter type String is not present"
        );
      const scope = springScope(queryValues(request, 'scope'));
      if (scope.error !== undefined) return javaError(request, 400, 'BAD_REQUEST', scope.error);
      const forced = queryValues(request, 'Force filters');
      const force = springBoolean(forced);
      if (force.error !== undefined) return javaError(request, 400, 'BAD_REQUEST', force.error);
      const unexpected = () => unexpectedFailure(request);
      // Only one empty value takes the default; any other blank converts to
      // null, which SearchService's primitive forceFilters cannot take.
      if (
        force.value === undefined &&
        forced.length > 0 &&
        !(forced.length === 1 && forced[0] === '')
      )
        return unexpected();
      const query = {
        query: given.join(','),
        scope: scope.value,
        species: springList(queryValues(request, 'species')),
        types: springList(queryValues(request, 'types')),
        keywords: springList(queryValues(request, 'keywords')),
        compartments: springList(queryValues(request, 'compartments')),
      };
      // An empty query is SearchService's null, before any scope is read.
      if (query.query === '') return { status: 200 };
      if (scope.value === null) return unexpected();
      return fromSolr(request, '/ContentService/search/facet_query', async (signal) => ({
        status: 200,
        type: 'application/json',
        body: await facetsOf(query, force.value === true, signal),
      }));
    },
  },
  {
    path: '/ContentService/search/diagram/summary',
    // SearchService.getDiagramSearchSummary, for the Pathway Browser's
    // search: how many match in the diagram and in the whole species overview, for
    // a species and the entries without one -- counts only. Not checked as
    // an identifier: Java does not. Before /diagram/{diagram}, which would
    // otherwise take "summary" for a diagram.
    handler: (request) => {
      const given = queryValues(request, 'query');
      if (given.length === 0)
        return javaError(request, 400, 'BAD_REQUEST', requiredString('query'));
      const species = queryValues(request, 'species');
      const diagram = queryValues(request, 'diagram');
      if (diagram.length === 0)
        return javaError(request, 400, 'BAD_REQUEST', requiredString('diagram'));
      const scope = springScope(queryValues(request, 'scope'), 'REFERENCE_ENTITY');
      if (scope.error !== undefined) return javaError(request, 400, 'BAD_REQUEST', scope.error);
      const interactors = springBoolean(queryValues(request, 'includeInteractors'));
      if (interactors.error !== undefined)
        return javaError(request, 400, 'BAD_REQUEST', interactors.error);
      if (blankBoolean(queryValues(request, 'includeInteractors'), interactors))
        return unexpectedFailure(request);
      const query = {
        query: given.join(','),
        species: [singleString(species, 'Homo sapiens'), 'Entries without species'],
        diagram: diagram.join(','),
        scope: scope.value,
        includeInteractors: interactors.value === true,
        start: 0,
        rows: 0,
      };
      if (query.scope === null) return unexpectedFailure(request);
      return fromSolr(request, '/ContentService/search/diagram/summary', async (signal) => {
        const ask = async (): Promise<[EntriesResult, EntriesResult]> => [
          entriesResult(await solr('/diagrams', diagramParams(query), { signal })),
          entriesResult(await solr('/fireworks', speciesWideParams(query), { signal }), {
            speciesWide: true,
          }),
        ];
        let [diagramResult, fireworksResult] = await ask();
        if (!(fireworksResult.found > 0)) {
          query.scope = 'BOTH';
          [diagramResult, fireworksResult] = await ask();
        }
        return { status: 200, type: 'application/json', body: { diagramResult, fireworksResult } };
      });
    },
  },
  {
    path: '/ContentService/search/diagram/{pathwayId}/flag',
    // SearchController.getEntitiesInDiagramForIdentifier, which the Pathway
    // Browser asks when flagging a term in the diagram on screen.
    handler: async (request) => {
      const pathway = pathId(rawSegment(request, 4));
      const given = queryValues(request, 'query');
      if (given.length === 0)
        return javaError(request, 400, 'BAD_REQUEST', requiredString('query'));
      const interactors = springBoolean(queryValues(request, 'includeInteractors'));
      if (interactors.error !== undefined)
        return javaError(request, 400, 'BAD_REQUEST', interactors.error);
      const problems = await identifierProblems(pathway).catch((failure: Failure) => failure);
      if (problems instanceof Error) {
        if (problems.unexpected) return unexpectedFailure(request);
        if (problems.javaMessage)
          return javaError(request, 500, 'INTERNAL_SERVER_ERROR', problems.javaMessage);
        throw problems;
      }
      if (problems) return javaError(request, 400, 'BAD_REQUEST', problems);
      if (blankBoolean(queryValues(request, 'includeInteractors'), interactors))
        return unexpectedFailure(request);
      const query = given.join(',');
      const field = interactors.value === true ? 'occurrencesWithInteractor' : 'occurrences';
      return fromSolr(
        request,
        '/ContentService/search/diagram/{pathwayId}/flag',
        async (signal) => {
          const flags = diagramFlags(
            await solr(
              '/diagrams/flagging',
              [
                ['q', `"${query}" AND ${field}:${pathway}*`],
                ['fl', `${field},stId`],
                ['rows', '100'],
              ],
              { signal }
            ),
            pathway,
            field
          );
          if (!flags.occurrences && !flags.interactsWith)
            return notFound(request, `No entities with identifier '${query}' found for ${pathway}`);
          return { status: 200, type: 'application/json', body: flags };
        }
      );
    },
  },
  {
    path: '/ContentService/search/diagram/{diagram}/occurrences/{instance}',
    // SearchController.getDiagramOccurrences: where an object occurs in a
    // diagram -- its subpathways there, and what it interacts with -- read
    // from the first of its occurrences that starts with the diagram's id.
    handler: async (request) => {
      const diagram = pathId(rawSegment(request, 4));
      const instance = pathId(rawSegment(request, 6));
      // types is bound, but getDiagramOccurrences never reads it.
      const interactors = springBoolean(queryValues(request, 'includeInteractors'));
      if (interactors.error !== undefined)
        return javaError(request, 400, 'BAD_REQUEST', interactors.error);
      const problems = await identifierProblems(diagram, instance).catch(
        (failure: Failure) => failure
      );
      if (problems instanceof Error) {
        if (problems.unexpected) return unexpectedFailure(request);
        if (problems.javaMessage)
          return javaError(request, 500, 'INTERNAL_SERVER_ERROR', problems.javaMessage);
        throw problems;
      }
      if (problems) return javaError(request, 400, 'BAD_REQUEST', problems);
      if (blankBoolean(queryValues(request, 'includeInteractors'), interactors))
        return unexpectedFailure(request);
      const field = interactors.value === true ? 'occurrencesWithInteractor' : 'occurrences';
      return fromSolr(
        request,
        '/ContentService/search/diagram/{diagram}/occurrences/{instance}',
        async (signal) => {
          const ask = async (scope) => {
            const answer = await solr(
              '/diagrams/occurrences',
              [
                ...(SCOPE_FILTER[scope] ? [pair('fq', SCOPE_FILTER[scope])] : []),
                ['q', instance],
                ['fl', field],
              ],
              { signal }
            );
            for (const doc of answer?.response?.docs ?? [])
              for (const raw of solrStrings(doc, field))
                if (raw.startsWith(diagram)) return rawOccurrence(raw);
            return undefined;
          };
          const result = (await ask('REFERENCE_ENTITY')) ?? (await ask('BOTH'));
          if (!result)
            return notFound(request, `No occurrences of '${instance}' found in '${diagram}'`);
          return { status: 200, type: 'application/json', body: result };
        }
      );
    },
  },
  {
    path: '/ContentService/search/diagram/{diagram}',
    // SearchController.getDiagramResult: the Pathway Browser's search within
    // a diagram -- Solr's /diagrams handler, filtered to the diagram as given
    // (so a dbId or a versioned id, which pass the check, find nothing),
    // asked again in every scope when the first finds nothing.
    handler: async (request) => {
      const diagram = pathId(rawSegment(request, 4));
      const given = queryValues(request, 'query');
      if (given.length === 0)
        return javaError(request, 400, 'BAD_REQUEST', requiredString('query'));
      const types = springList(queryValues(request, 'types'));
      const start = springIntegerWithDefault(queryValues(request, 'start'), null);
      if (start.error !== undefined) return javaError(request, 400, 'BAD_REQUEST', start.error);
      const rows = springIntegerWithDefault(queryValues(request, 'rows'), null);
      if (rows.error !== undefined) return javaError(request, 400, 'BAD_REQUEST', rows.error);
      const scope = springScope(queryValues(request, 'scope'));
      if (scope.error !== undefined) return javaError(request, 400, 'BAD_REQUEST', scope.error);
      const interactors = springBoolean(queryValues(request, 'includeInteractors'));
      if (interactors.error !== undefined)
        return javaError(request, 400, 'BAD_REQUEST', interactors.error);
      const problems = await identifierProblems(diagram).catch((failure: Failure) => failure);
      if (problems instanceof Error) {
        if (problems.unexpected) return unexpectedFailure(request);
        if (problems.javaMessage)
          return javaError(request, 500, 'INTERNAL_SERVER_ERROR', problems.javaMessage);
        throw problems;
      }
      if (problems) return javaError(request, 400, 'BAD_REQUEST', problems);
      if (
        blankBoolean(queryValues(request, 'includeInteractors'), interactors) ||
        scope.value === null
      )
        return unexpectedFailure(request);
      const query = {
        query: given.join(','),
        types,
        start: start.value,
        rows: rows.value,
        scope: scope.value,
        includeInteractors: interactors.value === true,
        diagram,
      };
      return fromSolr(request, '/ContentService/search/diagram/{diagram}', async (signal) => {
        let result = entriesResult(await solr('/diagrams', diagramParams(query), { signal }));
        if (!(result.found > 0)) {
          query.scope = 'BOTH';
          result = entriesResult(await solr('/diagrams', diagramParams(query), { signal }));
        }
        if (!(result.found > 0))
          return notFound(request, `No entries found for '${query.query}' in diagram '${diagram}'`);
        return { status: 200, type: 'application/json', body: result };
      });
    },
  },
  {
    path: '/ContentService/search/fireworks/flag',
    // SearchController.fireworksFlagging, which the Pathway Browser asks to
    // flag a term across the whole species overview.
    handler: async (request) => {
      const given = queryValues(request, 'query');
      if (given.length === 0)
        return javaError(request, 400, 'BAD_REQUEST', requiredString('query'));
      const name = singleString(queryValues(request, 'species'), 'Homo sapiens');
      // SpeciesService.getSpeciesByName: a Species with exactly that name.
      const named = await read<{
        dbId: number;
        displayName: string | null;
        abbreviation: string | null;
      }>(
        'MATCH (n:Species) WHERE $name IN n.name RETURN n.dbId AS dbId, n.displayName AS displayName, n.abbreviation AS abbreviation LIMIT 2',
        { name }
      );
      // The repository returns one Species: two of the same name is Spring
      // Data's failure, not a choice between them.
      if (named.length > 1) return unexpectedFailure(request);
      const [species] = named;
      if (!species) return javaError(request, 400, 'BAD_REQUEST', `No species found for '${name}'`);
      const query = given.join(',');
      return fromSolr(request, '/ContentService/search/fireworks/flag', async (signal) => {
        const flags = speciesWideFlags(
          await solr(
            '/fireworks/flagging',
            [
              ['fl', 'llps,occurrences'],
              ['q', query],
              ['fq', `fireworksSpecies:("${species.displayName}" OR "Entries without species")`],
              ['rows', '100'],
            ],
            { signal }
          ),
          species.abbreviation
        );
        if (!flags.llps && !flags.interactsWith)
          return notFound(
            request,
            `No entries found for query: '${query}' in species '${speciesToString(species)}'`
          );
        return { status: 200, type: 'application/json', body: flags };
      });
    },
  },
  {
    path: '/ContentService/search/pathways/of/{dbId}',
    // SearchController.getContainingPathwaysOf, which the Pathway Browser
    // asks for a search result's diagrams: the entity's occurrences from its
    // document (Solr's /get by dbId), then those diagrams' documents by
    // stable id, with only the fields asked for.
    handler: async (request) => {
      const dbId = springPathLong(pathId(rawSegment(request, 5)), 'dbId');
      if (dbId.error !== undefined)
        return javaError(
          request,
          dbId.status,
          dbId.status === 500 ? 'INTERNAL_SERVER_ERROR' : 'BAD_REQUEST',
          dbId.error
        );
      const interactorValues = queryValues(request, 'includeInteractors');
      const interactors = springBoolean(interactorValues);
      if (interactors.error !== undefined)
        return javaError(request, 400, 'BAD_REQUEST', interactors.error);
      const directValues = queryValues(request, 'directlyInDiagram');
      const direct = springBoolean(directValues);
      if (direct.error !== undefined) return javaError(request, 400, 'BAD_REQUEST', direct.error);
      const speciesValues = queryValues(request, 'species');
      const species = speciesValues.length ? speciesValues.join(',') : null;
      const fields = springFields(queryValues(request, 'fields'));
      if (fields.error !== undefined) return javaError(request, 400, 'BAD_REQUEST', fields.error);
      // includeInteractors is unboxed first, then the fields are named: a null
      // in either is Java's NullPointerException.
      if (blankBoolean(interactorValues, interactors)) return unexpectedFailure(request);
      const field = interactors.value === true ? 'occurrencesWithInteractor' : 'occurrences';
      return fromSolr(request, '/ContentService/search/pathways/of/{dbId}', async (signal) => {
        const found = await solr(
          '/get',
          [
            ['fl', field],
            ['ids', String(dbId.value)],
          ],
          { signal }
        );
        const [doc] = found?.response?.docs ?? [];
        const none = () => notFound(request, `No pathways found for dbId: ${dbId.value}`);
        if (!doc || !(field in doc)) return none();
        let occurrences = solrStrings(doc, field).map((raw) => rawOccurrence(raw));
        if (blankBoolean(directValues, direct)) return unexpectedFailure(request);
        if (direct.value === true)
          occurrences = occurrences.filter((occurrence) => occurrence.inDiagram);
        const stIds = occurrences.map((occurrence) => occurrence.diagramEntity ?? null);
        if ((fields.value ?? []).includes(null)) return unexpectedFailure(request);
        const answer = await solr(
          '/select',
          [
            ['q', `{!terms f=stId}${stIds.join(',').toLowerCase()}`],
            ['rows', String(stIds.length)],
            ...(species === null ? [] : [pair('fq', `species:${species}`)]),
            ...(fields.value?.length ? [pair('fl', fields.value.join(','))] : []),
          ],
          { signal }
        );
        const entries = (answer?.response?.docs ?? []).map((pathway) => searchEntry(pathway, null));
        if (!entries.length) return none();
        return { status: 200, type: 'application/json', body: entries };
      });
    },
  },
  {
    path: '/ContentService/search/fireworks',
    // SearchController.getFireworksResult: the species-wide search behind the
    // Pathway Browser's "All pathways" results and its FoamTree, whatever
    // the old widget's name in the path. Finding nothing, it names the terms
    // Reactome could annotate and reports the search.
    handler: async (request) => {
      const given = queryValues(request, 'query');
      if (given.length === 0)
        return javaError(request, 400, 'BAD_REQUEST', requiredString('query'));
      const species = singleString(queryValues(request, 'species'), 'Homo sapiens');
      const types = springList(queryValues(request, 'types'));
      const start = springIntegerWithDefault(queryValues(request, 'start'), null);
      if (start.error !== undefined) return javaError(request, 400, 'BAD_REQUEST', start.error);
      const scope = springScope(queryValues(request, 'scope'));
      if (scope.error !== undefined) return javaError(request, 400, 'BAD_REQUEST', scope.error);
      const interactorValues = queryValues(request, 'includeInteractors');
      const interactors = springBoolean(interactorValues);
      if (interactors.error !== undefined)
        return javaError(request, 400, 'BAD_REQUEST', interactors.error);
      const rows = springIntegerWithDefault(queryValues(request, 'rows'), null);
      if (rows.error !== undefined) return javaError(request, 400, 'BAD_REQUEST', rows.error);
      // The Builder unboxes includeInteractors: Java's NullPointerException.
      if (blankBoolean(interactorValues, interactors)) return unexpectedFailure(request);
      const query = {
        query: given.join(','),
        species: [species, 'Entries without species'],
        types,
        start: start.value,
        rows: rows.value,
        scope: scope.value,
      };
      if (query.scope === null) return unexpectedFailure(request);
      return fromSolr(request, '/ContentService/search/fireworks', async (signal) => {
        const result = entriesResult(
          await solr('/fireworks', speciesWideParams(query), { signal }),
          {
            speciesWide: true,
          }
        );
        if (result.found > 0) return { status: 200, type: 'application/json', body: result };
        const targets = await targetsOf(query.query, query.scope, signal);
        reportNotFound(await reportInformation(request), query.query, targets);
        const missing = javaError(
          request,
          404,
          'NOT_FOUND',
          `No entries found for query: ${query.query}`
        );
        if (targets.length === 0) return missing;
        const envelope = JSON.parse(missing.body);
        envelope.targets = targets;
        return { ...missing, body: javaJson(envelope) };
      });
    },
  },
  {
    path: '/ContentService/search/query/paginated',
    // SearchController.getResult: the search by page and rows per page, each
    // type given its share of the rows when clustered. Before /search/query.
    handler: async (request) => {
      const given = queryValues(request, 'query');
      if (given.length === 0)
        return javaError(request, 400, 'BAD_REQUEST', requiredString('query'));
      const page = springInteger(queryValues(request, 'page'), 'page');
      if (page.error !== undefined) return javaError(request, 400, 'BAD_REQUEST', page.error);
      const rowCount = springInteger(queryValues(request, 'rowCount'), 'rowCount');
      if (rowCount.error !== undefined)
        return javaError(request, 400, 'BAD_REQUEST', rowCount.error);
      const lists = {
        species: springList(queryValues(request, 'species')),
        types: springList(queryValues(request, 'types')),
        compartments: springList(queryValues(request, 'compartments')),
        keywords: springList(queryValues(request, 'keywords')),
      };
      const clusterValues = queryValues(request, 'cluster');
      const cluster = springBoolean(clusterValues);
      if (cluster.error !== undefined) return javaError(request, 400, 'BAD_REQUEST', cluster.error);
      const scope = springScope(queryValues(request, 'scope'));
      if (scope.error !== undefined) return javaError(request, 400, 'BAD_REQUEST', scope.error);
      const parser = springEnum(
        queryValues(request, 'parserType'),
        'STD',
        'org.reactome.server.search.domain.ParserType',
        Object.keys(PARSER_TYPES)
      );
      if (parser.error !== undefined) return javaError(request, 400, 'BAD_REQUEST', parser.error);
      if (page.value <= 0)
        return javaError(request, 400, 'BAD_REQUEST', 'page should be greater than 0');
      if (rowCount.value <= 0)
        return javaError(request, 400, 'BAD_REQUEST', 'rowCount should be greater than 0');
      if (blankBoolean(clusterValues, cluster)) return unexpectedFailure(request);
      // A null scope or parser fails once facets are asked for -- which an
      // empty query never is: Java falls back to the Builder's defaults.
      if (given.join(',') !== '' && (scope.value === null || parser.value === null))
        return unexpectedFailure(request);
      const query = {
        query: given.join(','),
        originalQuery: given.join(','),
        ...lists,
        scope: scope.value,
        parserType: parser.value,
        start: null,
        rows: null,
      };
      return fromSolr(request, '/ContentService/search/query/paginated', async (signal) =>
        searchAnswer(
          request,
          query.query,
          await searchFor(query, {
            rowCount: rowCount.value,
            page: page.value,
            grouped: cluster.value !== false,
            force: false,
            request,
            signal,
          })
        )
      );
    },
  },
  {
    path: '/ContentService/search/query',
    // SearchController.getSearchResult: the website's search, grouped by
    // type unless asked not to, from "Start row" for "rows".
    handler: async (request) => {
      const given = queryValues(request, 'query');
      if (given.length === 0)
        return javaError(request, 400, 'BAD_REQUEST', requiredString('query'));
      const lists = {
        species: springList(queryValues(request, 'species')),
        types: springList(queryValues(request, 'types')),
        compartments: springList(queryValues(request, 'compartments')),
        keywords: springList(queryValues(request, 'keywords')),
      };
      const clusterValues = queryValues(request, 'cluster');
      const cluster = springBoolean(clusterValues);
      if (cluster.error !== undefined) return javaError(request, 400, 'BAD_REQUEST', cluster.error);
      const parser = springEnum(
        queryValues(request, 'parserType'),
        'STD',
        'org.reactome.server.search.domain.ParserType',
        Object.keys(PARSER_TYPES)
      );
      if (parser.error !== undefined) return javaError(request, 400, 'BAD_REQUEST', parser.error);
      const start = springIntegerWithDefault(queryValues(request, 'Start row'), 0);
      if (start.error !== undefined) return javaError(request, 400, 'BAD_REQUEST', start.error);
      const rows = springIntegerWithDefault(queryValues(request, 'rows'), 10);
      if (rows.error !== undefined) return javaError(request, 400, 'BAD_REQUEST', rows.error);
      const scope = springScope(queryValues(request, 'scope'));
      if (scope.error !== undefined) return javaError(request, 400, 'BAD_REQUEST', scope.error);
      const forceValues = queryValues(request, 'Force filters');
      const force = springBoolean(forceValues);
      if (force.error !== undefined) return javaError(request, 400, 'BAD_REQUEST', force.error);
      // cluster and forceFilters are unboxed when the search is called.
      if (blankBoolean(clusterValues, cluster) || blankBoolean(forceValues, force))
        return unexpectedFailure(request);
      // The scope and parser fail once facets are asked for -- which an empty
      // query never is: Java falls back to the Builder's defaults.
      if (given.join(',') !== '' && (scope.value === null || parser.value === null))
        return unexpectedFailure(request);
      const query = {
        query: given.join(','),
        originalQuery: given.join(','),
        ...lists,
        scope: scope.value,
        parserType: parser.value,
        start: start.value,
        rows: rows.value,
      };
      return fromSolr(request, '/ContentService/search/query', async (signal) =>
        searchAnswer(
          request,
          query.query,
          await searchFor(query, {
            rowCount: 0,
            page: 0,
            grouped: cluster.value !== false,
            force: force.value === true,
            request,
            signal,
          })
        )
      );
    },
  },
  ...citationEndpoints,
  {
    path: '/ContentService/search/icon/facet',
    // SearchService.getIconFacetingInformation: the icon library's
    // categories, counted by Solr's /icon/facet handler over the icons.
    handler: (request) =>
      fromSolr(request, '/ContentService/search/icon/facet', async (signal) =>
        facetAnswer(await solr('/icon/facet', [['q', '{!term f=type}icon']], { signal }))
      ),
  },
  {
    path: '/ContentService/search/icon/query',
    // SearchController.iconQuery: the icon library's page, by name, of the
    // icons in a category and matching a text -- the query search-core is
    // given is the category's facet, then the text, else everything. Before
    // /icon/{identifier}, which would otherwise take "query" for an id.
    handler: (request) => {
      const text = queryValues(request, 'query');
      const category = queryValues(request, 'category');
      const page = springIntegerWithDefault(queryValues(request, 'page'), 1);
      if (page.error !== undefined) return javaError(request, 400, 'BAD_REQUEST', page.error);
      const size = springIntegerWithDefault(queryValues(request, 'pageSize'), 28);
      if (size.error !== undefined) return javaError(request, 400, 'BAD_REQUEST', size.error);
      // rows * (page - 1) unboxes both: a null is Java's NullPointerException.
      if (page.value === null || size.value === null) return unexpectedFailure(request);
      let q = '';
      const inCategory = category.join(',');
      if (inCategory !== '')
        q = `iconCategories_facet:${inCategory.toLowerCase().replace(/[ \t\n\v\f\r]+/g, '_')}`;
      const matching = text.join(',');
      if (matching !== '') q = q === '' ? matching : `${q} ${matching}`;
      if (q === '') q = '*';
      // Java's int arithmetic, overflow and all: Solr refuses a negative start.
      const start = Math.imul(size.value, page.value - 1);
      return fromSolr(request, '/ContentService/search/icon/query', async (signal) => ({
        status: 200,
        type: 'application/json',
        body: searchResult(
          await solr(
            '/search',
            [
              ['sort', 'iconName_sort asc'],
              ['start', String(start)],
              ['rows', String(size.value)],
              ['q', q],
              ['fq', '{!term f=type}icon'],
            ],
            { signal }
          ),
          true
        ),
      }));
    },
  },
  {
    path: '/ContentService/search/icon/{identifier}',
    // SearchController.iconDetail: one icon by its stable id, the first of
    // what Solr's /search finds for stId:{identifier} among icons; none is
    // Java's 404, naming the id as given.
    handler: (request) => {
      const identifier = pathId(rawSegment(request, 4));
      return fromSolr(request, '/ContentService/search/icon/{identifier}', async (signal) => {
        const answer = await solr(
          '/search',
          [
            ['q', `stId:${identifier}`],
            ['fq', 'exactType:Icon'],
            ['mm', '100%'],
          ],
          { signal }
        );
        if (!((answer?.response?.numFound ?? 0) > 0))
          return notFound(request, `Icon not found: ${identifier}`);
        return {
          status: 200,
          type: 'application/json',
          // numFound > 0 with no documents cannot happen at Solr's default rows.
          // If it did, searchResult leaves `entries` out, this throws, and
          // fromSolr answers its Solr failure -- not Java's NullPointerException
          // answer, as it did before it was typed.
          body: present(searchResult(answer, false).entries)[0],
        };
      });
    },
  },
];

/**
 * The endpoint a path was expanded from, by its whole template. Matching on
 * the text before the first `{` gave every /schema/{id}/... path to the first
 * of them, /count, so /min was judged by /count's declared differences and
 * failed on a difference it declares itself.
 */
export function endpointFor(path: string): Endpoint | undefined {
  return endpoints.find((e) => endpointPattern(e.path, '(\\?|$)').test(path));
}

/** An endpoint's template as a pattern over a path, `tail` after it. */
function endpointPattern(template, tail) {
  const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(
    `^${template
      .split(/\{\w+\}/)
      .map(escape)
      .join('[^/?]+')}${tail}`
  );
}

/** The GET endpoint Express would route `path` (no query) to, if any. */
function getEndpointFor(path) {
  return (
    endpoints
      // GET endpoints declare no method; the only one declared is 'post'.
      .filter((e) => !e.method)
      .find((e) => endpointPattern(e.path, '$').test(path))
  );
}

/**
 * `attributes` as the in-depth controllers read it: Spring joins repeated
 * values with ',', and an empty one takes the default; String.split(',')
 * drops trailing empties; an empty list means species. Joined with '|' for
 * the relationship pattern -- and refused unless that is relationship type
 * names, because Java writes it into the query text unchecked.
 */
export function inDepthAttributes(
  values: string[],
  fallback = 'species,compartment'
): Bound<string> {
  const text = values.length && values.join(',') !== '' ? values.join(',') : fallback;
  const parts = text.split(',');
  while (parts.length && parts[parts.length - 1] === '') parts.pop();
  const joined = (parts.length ? parts : ['species']).join('|');
  if (!/^[A-Za-z_][A-Za-z0-9_]*(\|[A-Za-z_][A-Za-z0-9_]*)*$/.test(joined))
    return { error: `attributes must be relationship type names, not: ${text}` };
  return { value: joined };
}

/** rfd-snapshot.json: the extensions Spring trusts (snapshot-rfd.ts). */
export interface RfdSnapshot {
  safe: string[];
}

/** rfd-snapshot.json's extensions, read on first use. */
let safeExtensions;

/**
 * Whether Java would mark this answer `Content-Disposition:
 * inline;filename=f.txt` -- Spring's guard against a reflected download
 * (AbstractMessageConverterMethodProcessor.addContentDispositionHeader), on
 * every body it writes but a redirect's. The request path's last segment is
 * percent-decoded and its extension -- after the last '.' -- checked. An
 * extension Spring does not trust (rfd-snapshot.json; snapshot-rfd.ts says
 * which it does) on either is marked: a versioned id, `R-HSA-69620.5`, as
 * much as `.exe`.
 */
export function downloadGuard(request) {
  const uri = present(String(request.originalUrl ?? '').split('?')[0]);
  const last = uri.slice(uri.lastIndexOf('/') + 1);
  safeExtensions ??= new Set(
    (
      JSON.parse(
        readFileSync(new URL('./rfd-snapshot.json', import.meta.url), 'utf8')
      ) as RfdSnapshot
    ).safe
  );
  const trusted = (text) => {
    let decoded = text;
    try {
      decoded = decodeURIComponent(text);
    } catch {
      // Left as it came; Tomcat has refused a malformed escape before this.
    }
    const dot = decoded.lastIndexOf('.');
    if (dot === -1 || decoded.lastIndexOf('/') > dot) return true;
    const extension = decoded.slice(dot + 1);
    return javaTrimAll(extension) === '' || safeExtensions.has(extension.toLowerCase());
  };
  return !trusted(last);
}

/**
 * A failure Java answers in its own way, or undefined. A dbId past a long's
 * range: Java's Long.parseLong throws, naming the id as it read it (trimmed,
 * any version cut); Neo4j's toInteger refuses it the same way, which is how
 * this sees it -- on every endpoint, whatever its id rules.
 */
export function failureAnswer(request, path, failure) {
  const tooLong = timedOut(request, failure);
  if (tooLong) return tooLong;
  if (
    failure?.code !== 'Neo.ClientError.Statement.TypeError' ||
    !/is too large$/.test(failure.message)
  )
    return undefined;
  // Java names the text it failed to parse: the id (as read: trimmed, any
  // version cut), or a query parameter that was converted the same way, such
  // as /pathways/low/entity's species. Neo4j names the digits it was given.
  const refused = failure.message.match(/integer, (\S+), is too large$/)?.[1];
  const idAt = path.split('/').indexOf('{id}');
  const candidates = [
    ...(idAt < 0 ? [] : [javaTrim(pathId(rawSegment(request, idAt))).split('.')[0]]),
    ...[...new URLSearchParams(String(request.originalUrl ?? '').split('?')[1] ?? '').values()],
  ];
  const named = candidates.find((text) => {
    const trimmed = javaTrim(text);
    return javaNumeric(trimmed) && asciiDigits(trimmed).replace(/^0+(?=\d)/, '') === refused;
  });
  if (named === undefined && idAt < 0) return undefined;
  return javaError(
    request,
    500,
    'INTERNAL_SERVER_ERROR',
    `For input string: "${named ?? candidates[0] ?? refused}"`
  );
}

/**
 * The collations of a Solr spellcheck answer, as SolrJ's
 * getCollatedResults reads them: JSON gives the list flat, name then value,
 * and a value is the collation itself or, when extended, an object carrying
 * it as collationQuery.
 */
export function collations(answer: SolrAnswer | null | undefined) {
  const flat = answer?.spellcheck?.collations ?? [];
  const found: (string | undefined)[] = [];
  for (let at = 0; at + 1 < flat.length; at += 2) {
    if (flat[at] !== 'collation') continue;
    const value = flat[at + 1];
    found.push(typeof value === 'string' ? value : value?.collationQuery);
  }
  return found.filter((value): value is string => typeof value === 'string');
}

/**
 * SolrConverter.getFacetMap's FacetMapping, from Solr's facet fields: the
 * field each facet field fills, in the order Jackson writes them.
 */
const FACET_FIELDS = new Map([
  ['species_facet', 'speciesFacet'],
  ['type_facet', 'typeFacet'],
  ['keywords_facet', 'keywordFacet'],
  ['compartment_facet', 'compartmentFacet'],
  ['iconCategories_facet', 'iconCategoriesFacet'],
]);

/**
 * A FacetMapping as ContentService writes it: every count Solr gave, in its
 * order, under the field its facet fills, and what the mapper's NON_EMPTY
 * leaves out left out -- an empty list, a null or empty name. Java's null, no
 * facet fields at all, is undefined. A facet field Java has no place for is
 * its NullPointerException, so a failure here too: a 500, though in the
 * envelope where Java's is Spring's own error page -- only a change to
 * solrconfig.xml could reach it.
 */
export function facetMapping(answer: SolrAnswer | null | undefined) {
  const fields: Record<string, unknown[] | null> = answer?.facet_counts?.facet_fields ?? {};
  if (Object.keys(fields).length === 0) return undefined;
  const lists: Written = {};
  for (const [field, flat] of Object.entries(fields)) {
    const key = FACET_FIELDS.get(field);
    if (!key) throw new Error(`a facet field search-core does not map: ${field}`);
    const available: FacetContainer[] = [];
    const counts = flat ?? [];
    for (let at = 0; at + 1 < counts.length; at += 2)
      available.push(facetContainer(counts[at], counts[at + 1]));
    lists[key] = available.length ? { available } : {};
  }
  const mapping = { totalNumFount: answer?.response?.numFound ?? 0 };
  for (const key of FACET_FIELDS.values()) if (key in lists) mapping[key] = lists[key];
  return mapping;
}

/** The filters a query takes, in the order SolrCore adds them, with its tag and field. */
const QUERY_FILTERS: [list: string, tag: string, field: string, key: string][] = [
  ['species', '{!tag=sf}', 'species_facet', 'speciesFacet'],
  ['types', '{!tag=tf}', 'type_facet', 'typeFacet'],
  ['keywords', '{!tag=kf}', 'keywords_facet', 'keywordFacet'],
  ['compartments', '{!tag=cf}', 'compartment_facet', 'compartmentFacet'],
];

/**
 * What SolrCore.getFacetingInformation(Query) sends the /facet handler: the
 * scope's filter, one tagged filter for each list given, not deleted, the
 * query. getFilterString drops empty names from a list as it goes -- they
 * are dropped here too, so the caller sees the lists as Java's are after --
 * and a list with nothing left is a bare tag, as Java sends it.
 */
export function facetQueryParams(query) {
  const params: [string, string][] = [];
  if (SCOPE_FILTER[query.scope]) params.push(['fq', SCOPE_FILTER[query.scope]]);
  for (const [list, tag, field] of QUERY_FILTERS) {
    const given = query[list];
    if (!given || given.length === 0) continue;
    const kept = given.filter((name) => name !== '' && name !== null);
    given.splice(0, given.length, ...kept);
    params.push(['fq', kept.length ? `${tag}${field}:("${kept.join('" OR "')}")` : tag]);
  }
  params.push(['fq', query.deleted ? 'deleted:true' : '-deleted']);
  if (PARSER_TYPES[query.parserType]) params.push(['defType', PARSER_TYPES[query.parserType]]);
  params.push(['q', query.query]);
  return params;
}

/** search-core's FacetMapping: the count, and a FacetList for each facet Solr counted. */
type FacetMapping = {
  totalNumFount: number;
  [key: string]: unknown;
  typeFacet?: { selected?: FacetContainer[]; available?: FacetContainer[] };
};

/**
 * SolrConverter.getFacetMap(response, query): each of the four facets split
 * into the names the query selected and the rest, as FacetList(selected,
 * available) -- a facet Solr did not count is left out, empty lists too.
 */
function facetMappingFor(answer: SolrAnswer | null | undefined, query) {
  const fields = answer?.facet_counts?.facet_fields ?? {};
  const mapping: FacetMapping = {
    totalNumFount: answer?.response?.numFound ?? 0,
  };
  const selected: Record<string, (string | null)[]> = {};
  for (const [list, , field, key] of QUERY_FILTERS) {
    if (!(field in fields)) continue;
    const flat = fields[field] ?? [];
    const chosen: FacetContainer[] = [];
    const available: FacetContainer[] = [];
    for (let at = 0; at + 1 < flat.length; at += 2) {
      const container = facetContainer(flat[at], flat[at + 1]);
      (query[list]?.includes(flat[at]) ? chosen : available).push(container);
    }
    selected[list] = chosen.map((container) => container.name ?? null);
    mapping[key] = {
      ...(chosen.length ? { selected: chosen } : {}),
      ...(available.length ? { available } : {}),
    };
  }
  return { mapping, selected };
}

/**
 * SearchService.getFacetingInformation(query, forceFilters): the facets of
 * `query`; unless filters are forced, a list whose names were not all found
 * is cut to those that were, and Solr asked again -- so a filter that
 * selects nothing is no filter. A list with no facet to check is Java's
 * NullPointerException, a failure here too.
 */
async function facetsOf(query, forceFilters, signal) {
  const ask = async () =>
    facetMappingFor(await solr('/facet', facetQueryParams(query), { signal }), query);
  const first = await ask();
  if (forceFilters) return first.mapping;
  let correct = true;
  for (const [list] of QUERY_FILTERS) {
    if (!query[list]) continue;
    const found = first.selected[list];
    if (found === undefined)
      throw Object.assign(new Error(`no ${list} facet to check the filter against`), {
        unexpected: true,
      });
    if (found.length !== query[list].length) {
      correct = false;
      query[list] = found;
    }
  }
  return correct ? first.mapping : (await ask()).mapping;
}

/**
 * SolrConverter.parseResponse's one Result: the documents as Entries, named
 * "Results", with Solr's count and how many came -- NON_EMPTY leaving out no
 * entries. `highlight` is false where Java ignores the highlighting.
 */
function searchResult(answer: SolrAnswer | null | undefined, highlight: boolean) {
  const docs = answer?.response?.docs ?? [];
  const highlighting = highlight ? (answer?.highlighting ?? {}) : {};
  const entries = docs.map((doc) => searchEntry(doc, highlighting));
  return {
    ...(entries.length ? { entries } : {}),
    typeName: 'Results',
    entriesCount: answer?.response?.numFound ?? 0,
    rowCount: entries.length,
  };
}

/**
 * SearchController.checkIdentifiers: what is wrong with a diagram id and,
 * when given, an object id, each looked up as graph-core's findById reads an
 * id -- in a TreeSet, so in String order, joined by " and " for Java's 400;
 * undefined when nothing is. Every id the graph does not have "cannot be
 * found", a blank one too, named as it was sent.
 */
async function identifierProblems(diagram, object?) {
  const report: string[] = [];
  const found = async (id) => {
    // graph-core's trimId splits an id without ':' at '.', and Java's split
    // of dots alone is empty: indexing it is the 500 below. Then findById's
    // Long.parseLong refuses a dbId past a long.
    const trimmed = javaTrim(id);
    if (!trimmed.includes(':') && trimmed !== '' && javaSplit(trimmed, '.').length === 0)
      throw Object.assign(new Error('an id of dots'), {
        javaMessage: 'Index 0 out of bounds for length 0',
      });
    const pastLong = longPastRange([id]);
    if (pastLong) throw Object.assign(new Error(pastLong), { javaMessage: pastLong });
    const { where, params } = resolveId(id);
    if (where === 'false') return undefined;
    const [row] = await read<{ labels: string[]; hasDiagram: boolean | null }>(
      `MATCH (n:DatabaseObject) WHERE ${where}
       RETURN labels(n) AS labels, n.hasDiagram AS hasDiagram LIMIT 1`,
      params
    );
    return row;
  };
  const d = await found(diagram);
  if (!d) report.push(`'${diagram}' cannot be found`);
  else if (!d.labels.includes('Pathway')) report.push(`'${diagram}' does not belong to a pathway`);
  else if (d.hasDiagram === null)
    // getHasDiagram() unboxed: Java's NullPointerException.
    throw Object.assign(new Error(`${diagram} has no hasDiagram`), { unexpected: true });
  else if (!d.hasDiagram) report.push(`'${diagram}' the pathway does not have diagram`);
  if (object !== undefined && !(await found(object))) report.push(`'${object}' cannot be found`);
  if (report.length === 0) return undefined;
  return [...new Set(report)].sort(compareJavaStrings).join(' and ');
}

/** String.compareTo: by UTF-16 unit, then by length. */
function compareJavaStrings(a, b) {
  const length = Math.min(a.length, b.length);
  for (let at = 0; at < length; at += 1) {
    const difference = a.charCodeAt(at) - b.charCodeAt(at);
    if (difference) return difference;
  }
  return a.length - b.length;
}

/** The FacetContainers of Solr's type facet, as search-core's diagram and species-wide results keep them. */
function typeFacets(answer: SolrAnswer | null | undefined) {
  const flat = answer?.facet_counts?.facet_fields?.['type_facet'] ?? [];
  const facets: FacetContainer[] = [];
  for (let at = 0; at + 1 < flat.length; at += 2)
    facets.push(facetContainer(flat[at], flat[at + 1]));
  return facets;
}

/**
 * A DiagramResult or FireworksResult: the documents as Entries (never
 * highlighted), the type facets, and Solr's count -- NON_EMPTY leaving out
 * no entries or no facets.
 */
type EntriesResult = ReturnType<typeof entriesResult>;

function entriesResult(answer: SolrAnswer | null | undefined, options = {}) {
  const entries = (answer?.response?.docs ?? []).map((doc) => searchEntry(doc, null, options));
  const facets = typeFacets(answer);
  return {
    ...(entries.length ? { entries } : {}),
    ...(facets.length ? { facets } : {}),
    found: answer?.response?.numFound ?? 0,
  };
}

/** The filters SolrCore adds for a query's species (fireworksSpecies) and types. */
function speciesAndTypes(query) {
  const params: [string, string][] = [];
  const filter = (list, field) => {
    const kept = list.filter((name) => name !== '' && name !== null);
    list.splice(0, list.length, ...kept);
    return kept.length ? `${field}:("${kept.join('" OR "')}")` : '';
  };
  if (query.species?.length) params.push(['fq', filter(query.species, 'fireworksSpecies')]);
  if (query.types?.length) params.push(['fq', `{!tag=tf}${filter(query.types, 'type_facet')}`]);
  return params;
}

/** start and rows, as SolrQuery sets them: a null one is left out. */
function paging(query): SolrParams {
  return [
    ...(query.start === null || query.start === undefined
      ? []
      : [pair('start', String(query.start))]),
    ...(query.rows === null || query.rows === undefined ? [] : [pair('rows', String(query.rows))]),
  ];
}

/** SolrCore.getDiagrams: the documents in a diagram matching the query. */
function diagramParams(query): SolrParams {
  return [
    ...(SCOPE_FILTER[query.scope] ? [pair('fq', SCOPE_FILTER[query.scope])] : []),
    ...speciesAndTypes(query),
    ['fq', `${query.includeInteractors ? 'diagramsWithInteractor' : 'diagrams'}:${query.diagram}`],
    ...paging(query),
    ['q', query.query],
  ];
}

/**
 * SolrCore.getFireworksResult: the species filter is always sent, empty or
 * not. "Fireworks" is the old name of the species overview, which is now the
 * Reacfoam (Voronoi) plot; it survives only in names fixed outside this
 * service -- Solr's /fireworks handler and fireworksSpecies field, Java's JSON
 * keys and the public /search/fireworks URLs -- and is kept there so answers
 * stay byte-identical and old links work.
 */
function speciesWideParams(query): SolrParams {
  const species = query.species ?? [];
  const kept = species.filter((name) => name !== '' && name !== null);
  const types = query.types?.length ? speciesAndTypes({ types: query.types }) : [];
  return [
    ...(SCOPE_FILTER[query.scope] ? [pair('fq', SCOPE_FILTER[query.scope])] : []),
    ['fq', kept.length ? `fireworksSpecies:("${kept.join('" OR "')}")` : ''],
    ...types,
    ...paging(query),
    ['q', query.query],
  ];
}

/** A String parameter with a default: absent or one empty value is the default; several are joined. */
function singleString(values, fallback) {
  if (values.length === 0 || (values.length === 1 && values[0] === '')) return fallback;
  return values.join(',');
}

/**
 * SearchManager.getDiagramOccurrencesResult: the documents Solr's
 * /diagrams/flagging finds for the term in the pathway (every scope, the
 * first hundred), each occurrence in the pathway folded into one result --
 * the document's own stable id when it is in the diagram, its subpathways,
 * and what it interacts with -- each a HashSet, NON_EMPTY leaving out none.
 */
function diagramFlags(answer, pathway, field) {
  const occurrences = new JavaHashMap();
  const interactsWith = new JavaHashMap();
  for (const doc of answer?.response?.docs ?? []) {
    for (const raw of solrStrings(doc, field)) {
      if (!raw.startsWith(pathway)) continue;
      const line = fourParts(raw, ':', OCCURRENCE_READS);
      // extractRawOccurrence with the document: the entity is its stId
      // when it is in the diagram, and in the diagram if that is non-empty.
      const entity = line[1].toLowerCase() === 'true' ? solrValue(doc, 'stId') : null;
      // stId is a string field.
      if (entity !== null && entity !== undefined && entity !== '')
        occurrences.set(entity as string, true);
      // Each list is first the occurrence's own HashSet, then added to the
      // whole one in that set's order.
      if (line[2] !== '#')
        for (const id of hashSetOf(javaSplit(line[2], ',')).keys()) occurrences.set(id, true);
      if (line[3] !== '#')
        for (const id of hashSetOf(javaSplit(line[3], ',')).keys()) interactsWith.set(id, true);
    }
  }
  // The site's DiagramFlagResult; this answer never has the entity fields,
  // and javaJson leaves an undefined one out.
  const result: JsonWritten<DiagramFlagResult> = {
    diagramEntity: undefined,
    inDiagram: undefined,
    occurrences: occurrences.size ? [...occurrences.keys()] : undefined,
    interactsWith: interactsWith.size ? [...interactsWith.keys()] : undefined,
  };
  return result;
}

/**
 * SolrConverter.fireworksFlagging then SearchManager's species filter: the
 * documents' lower-level pathways, and the diagrams where they have
 * interactors less those pathways, kept to the species' own ids
 * ("R-" + its abbreviation) -- each a HashSet, refilled after the filter.
 */
function speciesWideFlags(answer, abbreviation) {
  const llps = new JavaHashMap();
  const interactsWith = new JavaHashMap();
  for (const doc of answer?.response?.docs ?? []) {
    for (const id of solrStrings(doc, 'llps')) llps.set(id, true);
    for (const raw of solrStrings(doc, 'occurrences')) {
      // fireworksFlagging reads [0], then [3].
      const line = fourParts(raw, ':', [0, 3]);
      if (line[3] !== '#') interactsWith.set(line[0], true);
    }
  }
  if (llps.size && interactsWith.size) for (const id of llps.keys()) interactsWith.delete(id);
  const prefix = `R-${abbreviation}`;
  const kept = (map) => hashSetOf([...map.keys()].filter((id) => id.startsWith(prefix)));
  const species = kept(llps);
  const interacting = kept(interactsWith);
  // The site's SpeciesOverviewFlagResult; javaJson leaves an undefined one out.
  const result: JsonWritten<SpeciesOverviewFlagResult> = {
    llps: species.size ? [...species.keys()] : undefined,
    interactsWith: interacting.size ? [...interacting.keys()] : undefined,
  };
  return result;
}

/** A DatabaseObject's toString in graph-core, as Java's messages write a Species. */
function speciesToString(row) {
  return `Species {dbId=${row.dbId}, displayName='${row.displayName}'}`;
}

/** search-core's GroupedResult: the results, rows written, groups, matches; targets for none. */
interface SearchResult {
  results: unknown[];
  rowCount: number;
  numberOfGroups: unknown;
  numberOfMatches: unknown;
  targetResults?: TargetResult[];
}

/**
 * SolrConverter.parseClusteredResponse: the first grouping's groups, each
 * with entries a Result named by its group, the rows written, the groups and
 * matches -- a missing group count is Java's unboxing failure.
 */
function groupedEntries(answer: SolrAnswer | null | undefined): SearchResult | null {
  const grouped: Record<string, SolrGrouping> = answer?.grouped ?? {};
  const grouping = Object.values(grouped)[0];
  if (!grouping) return null;
  if (grouping.ngroups === undefined || grouping.ngroups === null)
    throw Object.assign(new Error('a grouping without ngroups'), { unexpected: true });
  const highlighting = answer?.highlighting ?? {};
  const results: unknown[] = [];
  let rows = 0;
  for (const group of grouping.groups ?? []) {
    const entries = (group.doclist?.docs ?? []).map((doc) => searchEntry(doc, highlighting));
    if (!entries.length) continue;
    results.push({
      entries,
      ...(group.groupValue === null || group.groupValue === ''
        ? {}
        : { typeName: group.groupValue }),
      entriesCount: group.doclist?.numFound ?? 0,
      rowCount: entries.length,
    });
    rows += entries.length;
  }
  return {
    results,
    rowCount: rows,
    numberOfGroups: grouping.ngroups,
    numberOfMatches: grouping.matches,
  };
}

/** SolrConverter.parseResponse with highlighting: one Result of everything. */
function plainEntries(answer: SolrAnswer | null | undefined): SearchResult {
  const result = searchResult(answer, true);
  return {
    results: [result],
    rowCount: result.rowCount,
    numberOfGroups: 1,
    numberOfMatches: Number(answer?.response?.numFound ?? 0) | 0,
  };
}

/**
 * SearchService.getSearchResult: the facets of the query; finding none,
 * asked again without the filters (the Builder's defaults, its scope
 * REFERENCE_ENTITY, no paging), then among the deleted, then by dismax, then
 * in every scope. Found: the page (setPagingParameters when none was given),
 * grouped or not; an empty page names the targets and reports. Found
 * nowhere: the targets, the report, and Java's null.
 */
async function searchFor(query, { rowCount, page, grouped, force, request, signal }) {
  const facetsFor = async () => (query.query === '' ? null : facetsOf(query, force, signal));
  query.deleted = false;
  let mapping = await facetsFor();
  if (mapping === null || mapping.totalNumFount < 1) {
    query = {
      query: query.query,
      originalQuery: query.originalQuery,
      scope: 'REFERENCE_ENTITY',
      deleted: false,
      parserType: 'STD',
      species: null,
      types: null,
      keywords: null,
      compartments: null,
      start: null,
      rows: null,
    };
    mapping = await facetsFor();
  }
  if (mapping !== null && mapping.totalNumFount === 0) {
    query.deleted = true;
    mapping = await facetsFor();
  }
  if (mapping !== null && mapping.totalNumFount === 0) {
    query.deleted = false;
    query.parserType = 'DISMAX';
    mapping = await facetsFor();
  }
  if (mapping !== null && mapping.totalNumFount === 0) {
    query.scope = 'BOTH';
    mapping = await facetsFor();
  }
  if (mapping !== null && mapping.totalNumFount > 0) {
    if (query.start === null || query.rows === null) {
      if (!mapping.typeFacet)
        throw Object.assign(new Error('no type facet to page by'), { unexpected: true });
      const typeCount = query.types?.length
        ? query.types.length
        : (mapping.typeFacet.available?.length ?? 0);
      if (typeCount !== 0) {
        const rows = grouped ? Math.trunc(rowCount / typeCount) : rowCount;
        query.start = Math.imul(rows, page - 1);
        query.rows = rows;
      }
    }
    const paging = query.start !== null && query.rows !== null;
    const result = grouped
      ? groupedEntries(
          await solr(
            '/search/grouped',
            [
              ...searchParams(query),
              ...(paging
                ? [
                    pair('group.offset', String(query.start)),
                    pair('group.limit', String(query.rows)),
                  ]
                : []),
              ['q', query.query],
            ],
            { signal }
          )
        )
      : plainEntries(
          await solr(
            '/search',
            [
              ...searchParams(query),
              ...(paging
                ? [pair('start', String(query.start)), pair('rows', String(query.rows))]
                : []),
              ['q', query.query],
            ],
            { signal }
          )
        );
    if (result?.rowCount === 0) {
      const targets = await targetsOf(query.query, query.scope, signal);
      if (targets.length) result.targetResults = targets;
      reportNotFound(await reportInformation(request), query.originalQuery, targets);
    }
    // new SearchResult(..., getHighestResultCount(result), query.getRows()):
    // no result, or no rows (no types to page by), is Java's
    // NullPointerException -- after any report.
    if (result === null || query.rows === null)
      throw Object.assign(new Error('a search result Java cannot build'), { unexpected: true });
    return result;
  }
  const targets = await targetsOf(query.query, query.scope, signal);
  reportNotFound(await reportInformation(request), query.originalQuery, targets);
  return null;
}

/** The controller's answer to a search: the GroupedResult, or the 404 with any targets. */
function searchAnswer(request, query, result) {
  if (result?.results?.length) {
    const { targetResults, ...written } = result;
    // NON_EMPTY, in a 200: a target's null or empty term or resource is
    // left out (a query with a leading space has an empty first term).
    const kept = (text) => text !== null && text !== undefined && text !== '';
    const targets = targetResults?.map(({ term, resource, target }) => ({
      ...(kept(term) ? { term } : {}),
      ...(kept(resource) ? { resource } : {}),
      target,
    }));
    return {
      status: 200,
      type: 'application/json',
      body: targets?.length ? { ...written, targetResults: targets } : written,
    };
  }
  const missing = javaError(request, 404, 'NOT_FOUND', `No entries found for query: ${query}`);
  if (!result?.targetResults?.length) return missing;
  const envelope = JSON.parse(missing.body);
  envelope.targets = result.targetResults;
  return { ...missing, body: javaJson(envelope) };
}

/** A FacetMapping endpoint's answer: the mapping, or Java's empty 200 for its null. */
function facetAnswer(answer) {
  const mapping = facetMapping(answer);
  return mapping === undefined
    ? { status: 200 }
    : { status: 200, type: 'application/json', body: mapping };
}

/**
 * SolrConverter.getSuggestions: the collations `handler` offers for `query`,
 * in order, less those /exists finds nothing for. One at a time, as Java
 * asks: Solr's heap is small and the list is a handful.
 */
export async function suggestionsFrom(handler, query, ask = solr, signal = undefined) {
  const offered = collations(await ask(handler, [['spellcheck.q', query]], { signal }));
  const kept: string[] = [];
  for (const collation of offered) {
    const exists = await ask('/exists', [['q', collation]], { signal });
    if ((exists?.response?.numFound ?? 0) > 0) kept.push(collation);
  }
  return kept;
}

/**
 * The files /health's build fingerprint hashes: the service's modules and the
 * data it answers with (schema-snapshot.json), sorted by name, whether a module
 * is `.mjs` or `.ts` (spec 013: renamed, it would drop out of the hash unseen).
 * Specs excluded.
 * They ship in the image -- the Dockerfile copies the directory -- but they are
 * not what the service does, and a fingerprint that changes when a test is
 * edited reports a deployment difference that is not one. Caught by this very
 * endpoint: adding service.spec.mjs moved the hash without changing a line the
 * service runs.
 */
export function fingerprintFiles(names: string[]) {
  return names
    .filter((name) => /\.(mjs|ts|json)$/.test(name) && !/\.(spec\.(mjs|ts)|d\.ts)$/.test(name))
    .sort();
}

/**
 * A fingerprint of the code this process is actually running.
 *
 * The image bakes these modules in, so `docker compose build` is a separate act
 * from merging and nothing connected the two: a fix could be merged and not
 * deployed, or a container could be quietly ahead of main, and the only way to
 * tell was to read the source on disk -- which is the CLI's copy, not the
 * container's, and therefore always agrees with you.
 *
 * A content hash rather than a git sha, because a sha has to be passed in at
 * build time and anything that has to be remembered eventually is not. Compare
 * it against a checkout with
 * `LC_ALL=C ls tools/content-node/*.mjs tools/content-node/*.json | grep -v spec | xargs cat | sha256sum`,
 * taking the files sorted by name, as here. The JSON is schema-snapshot.json:
 * data the service answers with, so a regenerated snapshot is a different build.
 */
function buildId() {
  try {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const names = fingerprintFiles(readdirSync(here));
    const hash = createHash('sha256');
    for (const name of names) hash.update(readFileSync(path.join(here, name)));
    return { build: hash.digest('hex').slice(0, 12), modules: names.length };
  } catch {
    // Never fail a health check over its own metadata.
    return { build: 'unknown', modules: 0 };
  }
}

const LATIN1_DISPOSITION = Symbol('latin1Disposition');

/**
 * Node reads a Content-Disposition value back as UTF-8 when the head goes
 * out with a body's bytes counted (nodejs/node#46528) -- so the Latin-1 byte
 * Tomcat writes for é became U+FFFD. Decided at end(), on the bytes Node is
 * given (a 304's '' and Express's bodiless HEAD are not converted, a HEAD's
 * Buffer is): then the value goes in as its UTF-8 bytes, and comes out é as
 * long as the head is written on its own, as Latin-1 -- which it is, because
 * Express hands end() a Buffer whenever it computes an ETag. Installed once
 * per response, so a second writeResult (an error after a first) does not
 * convert twice.
 */
function latin1Disposition(response) {
  if (response[LATIN1_DISPOSITION]) return;
  response[LATIN1_DISPOSITION] = true;
  const end = response.end.bind(response);
  response.end = (chunk, ...rest) => {
    const encoding = (typeof rest[0] === 'string' ? rest[0] : 'utf8') as BufferEncoding;
    const bytes =
      typeof chunk === 'string'
        ? Buffer.byteLength(chunk, encoding)
        : chunk && typeof chunk !== 'function'
          ? chunk.length
          : 0;
    const value = bytes > 0 && !response.headersSent && response.getHeader('Content-Disposition');
    if (typeof value === 'string')
      response.setHeader('Content-Disposition', Buffer.from(value, 'utf8').toString('latin1'));
    return end(chunk, ...rest);
  };
}

/**
 * A handler's answer on the wire. Objects go out as JSON written as Jackson
 * writes it (javaJson, not res.json's JSON.stringify); strings as they are, so
 * a text/plain endpoint is not quoted into JSON; a cached endpoint's body as it
 * was serialised once; and no body at all as nothing -- as Java sends when a
 * controller returns null, where send('') would add a text/html content type
 * Java does not.
 */
export function writeResult(response, result) {
  response.status(result.status);
  if (result.type) response.type(result.type);
  const body = result.body !== undefined || Boolean(result.serialised);
  for (const [name, value] of Object.entries(result.headers ?? {})) response.setHeader(name, value);
  latin1Disposition(response);
  const redirect = result.status >= 300 && result.status < 400;
  if (body && !redirect && response.req && downloadGuard(response.req))
    response.setHeader('Content-Disposition', 'inline;filename=f.txt');
  if (result.body === undefined && !result.serialised) response.end();
  else if (typeof result.body === 'string') response.send(result.body);
  // A figure's bytes, under the type the handler set.
  else if (Buffer.isBuffer(result.body)) response.end(result.body);
  else if (result.serialised) response.type('application/json').send(result.serialised);
  else response.type('application/json').send(javaJson(result.body));
}

/**
 * A POST's body, as the bytes that came: not inflated (Tomcat does not
 * inflate a request), and not refused for its type, which the handler checks
 * as Spring does. Past 10MB the rest is read and dropped and the handler
 * answers 413, where Java would read on; no client sends that many ids.
 */
function readBody(request, _response, next) {
  const chunks: Buffer[] = [];
  let size = 0;
  request.on('data', (chunk) => {
    size += chunk.length;
    if (size > 10 * 1024 * 1024) request.tooLarge = true;
    else chunks.push(chunk);
  });
  request.on('end', () => {
    request.body = Buffer.concat(chunks);
    next();
  });
  request.on('error', next);
}

/** The /data/query/{id}/{attribute} names node answers, by their lower case. */
const QUERY_ATTRIBUTES = { stid: 'stId', normalpathway: 'normalPathway' };

export function app() {
  const server = express();
  server.disable('x-powered-by');
  // Spring matches a mapping's literal segments by case; Express, by
  // default, does not -- /search/icon/QUERY was the icon page here and an
  // icon id to Java.
  server.set('case sensitive routing', true);

  // Readable from any origin, as Java's ContentService is: pages on other sites
  // read it -- the embeddable diagram (spec 009) asks for the species list from
  // a partner's page. The ported endpoints matched Java's bodies byte for byte
  // and still broke that, by leaving this header out. On every answer, errors
  // included, so a page elsewhere can read that a request failed; and a
  // preflight is answered the way Java answers it.
  server.use('/ContentService', (request, response, next) => {
    response.setHeader('Access-Control-Allow-Origin', '*');
    // Not stored at the edge unless an endpoint's answer says otherwise
    // (answer()): an error, a preflight or a path no endpoint answers is
    // never kept (spec 011).
    setLabel(response, defaultLabel(String(request.originalUrl)));
    if (request.method !== 'OPTIONS') return next();
    response.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE');
    response.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    response.setHeader('Access-Control-Max-Age', '1');
    response.sendStatus(200);
  });

  // Before any route, as Tomcat and Spring look at a path before any
  // controller does. A slash or backslash encoded, or a raw backslash, is Tomcat's 400 -- its page
  // names the server and its version, which this does not copy -- and a
  // doubled slash matches no mapping, which is Spring's own 404.
  server.use('/ContentService', (request, response, next) => {
    const path = present(String(request.originalUrl).split('?')[0]);
    if (/%2f|%5c|\\/i.test(path))
      return response
        .status(400)
        .type('text/html')
        .send(
          '<!doctype html><html lang="en"><head><title>HTTP Status 400 – Bad Request</title></head><body><h1>HTTP Status 400 – Bad Request</h1></body></html>'
        );
    if (path.includes('//')) return writeResult(response, springNotFound(request));
    // A matrix parameter (`/data;jsessionid=x/diseases`) is no URL of ours:
    // Java ignores one, but nothing sends one on purpose, and every way of
    // writing a URL is one more to cache. Spring's 404, as for any path no
    // mapping matches (decided 18 Oct 2026, spec 006 T008). An encoded ';'
    // (%3B) is part of an id, as it is to Java.
    if (path.includes(';')) return writeResult(response, springNotFound(request));
    const [head, query] = String(request.url).split(/\?(.*)/s);
    const relative = present(head);
    // Tomcat decodes the path before Spring matches it, so /icon/qu%65ry is
    // /icon/query to Java. Routing here sees letters, digits, '-', '_' and
    // '~' decoded too -- all a literal segment holds -- and handlers still
    // read ids from the path as it came.
    const routed = relative
      .replace(/%([0-9A-Fa-f]{2})/g, (escape: string, hex: string) => {
        const char = String.fromCharCode(parseInt(hex, 16));
        return /[A-Za-z0-9_~-]/.test(char) ? char : escape;
      })
      // Java's /query/{id}/{attributeName} finds the attribute's getter
      // ignoring case (ControllerUtils.getProperty); node's two are literal
      // routes, so the attribute is put in their case, a trailing slash
      // kept. Not under Java's more specific /query/enhanced/{id} and
      // /query/abridged/{id}, where that segment is an id.
      .replace(
        /^(\/data\/query\/([^/]+)\/)([^/]+)(\/?)$/,
        (path: string, head: string, id: string, attribute: string, slash: string) => {
          const lower = attribute.toLowerCase();
          if (['enhanced', 'abridged'].includes(id) || !Object.hasOwn(QUERY_ATTRIBUTES, lower))
            return path;
          return head + QUERY_ATTRIBUTES[lower] + slash;
        }
      );
    // One URL per answer (spec 011): Java answers /x/ as /x, and the edge
    // would keep both. A GET or HEAD for an endpoint, slashed, is sent to
    // the URL without the slash -- the path and query as they came. Not
    // when that would not be the same request: a raw `#` would become a
    // fragment, a malformed escape would be re-encoded; those are answered
    // as before, and never stored.
    const sentUrl = String(request.originalUrl);
    if (
      (request.method === 'GET' || request.method === 'HEAD') &&
      /.\/$/.test(routed) &&
      !sentUrl.includes('#') &&
      !/%(?![0-9A-Fa-f]{2})/.test(sentUrl)
    ) {
      const endpoint = getEndpointFor(`/ContentService${routed.slice(0, -1)}`);
      if (endpoint) {
        const [sent, sentQuery] = sentUrl.split(/\?(.*)/s);
        const location =
          present(sent).slice(0, -1) + (sentQuery === undefined ? '' : `?${sentQuery}`);
        setLabel(response, redirectLabel(location));
        return response.status(301).location(location).end();
      }
    }
    request.url = routed + (query === undefined ? '' : `?${query}`);
    next();
  });

  // Express 4 does not wait on a handler's promise; this one answers itself.
  server.get('/health', (_request, response) => {
    void (async () => {
      // The release this process is holding, which is the one thing here that can
      // be wrong without anything looking wrong. Caches live for the life of the
      // process by agreement -- updating the database includes restarting this --
      // and a missed restart shows up as diagram, figure and icon URLs pointing at
      // the previous release's bucket prefix, silently. Reporting it makes that
      // one curl away from obvious.
      //
      // Read through the same cache the endpoint uses, so this reports what is
      // being *served* rather than what the graph currently says. A health check
      // that went straight to the database would answer correctly while every
      // other response was stale, which is the opposite of useful.
      // Whatever the version endpoint's body is, written as it is.
      let release: unknown = null;
      try {
        const answer = await databaseVersion({ params: {}, query: {} });
        release = answer.body ?? null;
      } catch {
        // A health check that fails because the graph is down is reporting the
        // wrong thing: the process is up, and that is what this answers.
      }
      response.json({
        ok: true,
        ...buildId(),
        graph: configured(),
        solr: solrConfigured(),
        release,
        endpoints: endpoints.map((e) => e.path),
      });
    })();
  });

  for (const endpoint of endpoints) {
    // The table stores the Java path with {id}; express wants :id. Keeping one
    // string means the diff harness and proxy.conf.js can address an endpoint by
    // exactly what the Java service calls it.
    const route = endpoint.path.replace(/\{(\w+)\}/g, ':$1');
    // A POST's body arrives as bytes; its handler decodes them as Java would.
    const body = endpoint.method === 'post' ? [readBody] : [];
    // Express 4 does not wait on a handler's promise; answerWith answers itself.
    server[endpoint.method ?? 'get'](route, ...body, (request, response) => {
      void answerWith(endpoint, request, response);
    });
  }

  // Any other method on these paths is Java's 405: nginx sends every method
  // here, and Express's own answer was an HTML 404. After every route, so a
  // path two templates match is answered by the one that takes the method.
  for (const endpoint of endpoints) {
    server.all(endpoint.path.replace(/\{(\w+)\}/g, ':$1'), (request, response) =>
      writeResult(
        response,
        javaError(
          request,
          405,
          'METHOD_NOT_ALLOWED',
          `Request method '${request.method}' not supported`
        )
      )
    );
  }

  // A path no mapping matches is Spring's own 404 -- JSON, not Express's
  // HTML page. Since routing is by case, /data/database/VERSION is one.
  server.use('/ContentService', (request, response) =>
    writeResult(response, springNotFound(request))
  );

  // Express decodes route parameters before any handler runs, and a segment
  // that is not valid UTF-8 (%FF) made it answer its own HTML 400 -- a stack
  // trace, NODE_ENV being unset -- where Java decodes it to U+FFFD and answers
  // as usual. Handlers read the raw path (rawSegment), so the endpoint is run
  // regardless.
  server.use((failure, request, response, next) => {
    if (!(failure instanceof URIError) || response.headersSent) return next(failure);
    // The path as routing saw it, less a trailing slash, which Express
    // ignores too.
    const path = present(String(request.url).split('?')[0]).replace(/(.)\/$/, '$1');
    const endpoint = endpointFor(path);
    if (!endpoint) return next(failure);
    // HEAD is answered as GET, as Express answers it; any other method the
    // template does not take is Java's 405, as for a decodable id.
    const method = request.method === 'HEAD' ? 'get' : request.method.toLowerCase();
    if ((endpoint.method ?? 'get') !== method)
      return writeResult(
        response,
        javaError(
          request,
          405,
          'METHOD_NOT_ALLOWED',
          `Request method '${request.method}' not supported`
        )
      );
    const body = endpoint.method === 'post' ? readBody : (_request, _response, done) => done();
    body(request, response, () => answerWith(endpoint, request, response));
  });

  // Anything else that reaches here is this service's failure: Java's
  // envelope, never Express's page with a stack trace in it.
  server.use((failure, request, response, _next) => {
    console.error(`${request.path}: ${failure?.message}`);
    writeResult(response, unexpected(request));
  });

  return server;
}

/** DEEP_QUERY_LIMIT when it is a whole number from 1 to 32 (the pool's default); otherwise 4. */
export function deepLimit(setting) {
  const limit = Number(setting);
  return Number.isInteger(limit) && limit >= 1 && limit <= 32 ? limit : 4;
}

const DEEP = deepShare(deepLimit(settings.deepQueryLimit()));

/**
 * One endpoint's answer to one request: its handler's result, or what a
 * failure means in Java's terms, never a stack trace.
 */
async function answerWith(endpoint, request, response) {
  if (endpoint.deep) {
    if (!DEEP.enter())
      return writeResult(response, {
        ...javaError(request, 503, 'SERVICE_UNAVAILABLE', 'The service is busy; try again shortly'),
        headers: { 'Retry-After': '5' },
      });
    try {
      return await answer(endpoint, request, response);
    } finally {
      DEEP.leave();
    }
  }
  return answer(endpoint, request, response);
}

export async function answer(endpoint, request, response) {
  // The answer's caching label, from the request exactly as it was sent:
  // request.url has been rewritten for routing by now (spec 011).
  const write = (result) => {
    setLabel(
      response,
      label({
        method: request.method,
        endpoint: endpoint.path,
        originalUrl: String(request.originalUrl ?? ''),
        status: result.status,
      })
    );
    writeResult(response, result);
  };
  try {
    write(await endpoint.handler(request));
  } catch (caught) {
    const failure = caught as Failure;
    const answer = failureAnswer(request, endpoint.path, failure);
    if (answer) return write(answer);
    // The message, not a stack: this stands in for a service whose errors
    // reach real clients.
    console.error(`${endpoint.path}: ${failure.message}`);
    write({ status: 500, type: 'text/plain', body: 'content service error' });
  }
}

/**
 * Whether Node was started with this file, whatever it is called: the test
 * was `endsWith('service.mjs')`, which a service renamed to `.ts` (spec 013)
 * fails, so it would load, never listen, and exit 0 -- a restart loop in its
 * container. Compared after symlinks are resolved, as Node resolves its own.
 * scripts/is-entry.mjs does the same for the scripts, but the service images
 * ship only this directory.
 */
function startedDirectly() {
  const started = process.argv[1];
  try {
    return !!started && realpathSync(started) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

// Started directly rather than imported by a test.
if (startedDirectly()) {
  const server = app().listen(PORT, HOST, () => {
    console.log(`content-node listening on http://${HOST}:${PORT}`);
    // Warm the cached endpoints the way Java's @PostConstruct does, so the
    // first reader does not pay the four seconds. Failures are left to the
    // request path, which retries: warming must not be the thing that decides
    // whether the service can answer.
    // The PSICQUIC services, read now and every five minutes, as Java's
    // scheduler does.
    // A mistake of ours is logged, not left to end the process.
    const refresh = () =>
      void refreshPsicquicResources().catch((error) =>
        console.error(`PSICQUIC resources: ${error.stack}`)
      );
    refresh();
    setInterval(refresh, 5 * 60 * 1000).unref();
    for (const endpoint of endpoints) {
      if (!endpoint.handler.warms) continue;
      // A warmed handler is a cached one, which reads nothing of its request.
      Promise.resolve(endpoint.handler({ params: {} })).catch((error) =>
        console.error(`warming ${endpoint.path}: ${error.message}`)
      );
    }
    console.log(
      `  graph credentials: ${configured() ? 'present' : 'MISSING (set NEO4J_USER/PASSWORD)'}`
    );
    console.log(
      `  solr: ${solrConfigured() ? 'configured' : 'MISSING (set SOLR_URL/USER/PASSWORD)'}`
    );
    console.log(`  endpoints: ${endpoints.length}`);
  });
  const stop = async () => {
    server.close();
    await close();
    process.exit(0);
  };
  process.on('SIGINT', () => void stop());
  process.on('SIGTERM', () => void stop());
}
