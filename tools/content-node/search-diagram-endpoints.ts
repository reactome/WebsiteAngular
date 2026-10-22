/**
 * The diagram search endpoints (spec 014, research R1, a family): a term's
 * occurrences in a diagram and its summary (/search/diagram/*), the flags
 * on a diagram, and the species overview's search and flag
 * (/search/fireworks*, Java's name for the overview), with the helpers only
 * they use. Moved unchanged from service.ts.
 */
import type { Endpoint } from './endpoint.ts';
import { hashSetOf, javaSplit, javaTrim } from './java-text.ts';
import { longPastRange, resolveId } from './objects.ts';
import { read } from './graph.ts';
import type { SolrAnswer } from './solr.ts';
import type { FacetContainer } from './search-core.ts';
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
import type { SolrParams } from './search-params.ts';
import { SCOPE_FILTER, pair } from './search-params.ts';
import { JavaHashMap } from './java-hashmap.ts';
import type { Failure, JsonWritten } from './answers.ts';
import type {
  DiagramFlagResult,
  SpeciesOverviewFlagResult,
} from '../../projects/pathway-browser/src/app/model/flag.model.ts';
import {
  pathId,
  queryValues,
  rawSegment,
  requiredString,
  springBoolean,
  springIntegerWithDefault,
  springList,
  springScope,
} from './spring.ts';
import { javaError, javaJson, notFound, unexpectedFailure } from './answers.ts';
import { solr } from './solr.ts';

/**
 * SearchController.checkIdentifiers: what is wrong with a diagram id and,
 * when given, an object id, each looked up as graph-core's findById reads an
 * id -- in a TreeSet, so in String order, joined by " and " for Java's 400;
 * undefined when nothing is. Every id the graph does not have "cannot be
 * found", a blank one too, named as it was sent.
 */
async function identifierProblems(diagram: string, object?: string) {
  const report: string[] = [];
  const found = async (id: string) => {
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
function compareJavaStrings(a: string, b: string) {
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
    // Solr's flat list: a name, then its count.
    facets.push(facetContainer(flat[at] as string | null, flat[at + 1] as number));
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

/** A diagram search's query, as its controller binds it. */
interface DiagramQuery {
  query: string;
  scope: string | null;
  species?: (string | null)[] | null;
  types?: (string | null)[] | null;
  start?: number | null;
  rows?: number | null;
  includeInteractors?: boolean;
  diagram?: string;
}

/** The filters SolrCore adds for a query's species (fireworksSpecies) and types. */
function speciesAndTypes(query: Pick<DiagramQuery, 'species' | 'types'>) {
  const params: [string, string][] = [];
  const filter = (list: (string | null)[], field: string) => {
    const kept = list.filter((name) => name !== '' && name !== null);
    list.splice(0, list.length, ...kept);
    return kept.length ? `${field}:("${kept.join('" OR "')}")` : '';
  };
  if (query.species?.length) params.push(['fq', filter(query.species, 'fireworksSpecies')]);
  if (query.types?.length) params.push(['fq', `{!tag=tf}${filter(query.types, 'type_facet')}`]);
  return params;
}

/** start and rows, as SolrQuery sets them: a null one is left out. */
function paging(query: Pick<DiagramQuery, 'start' | 'rows'>): SolrParams {
  return [
    ...(query.start === null || query.start === undefined
      ? []
      : [pair('start', String(query.start))]),
    ...(query.rows === null || query.rows === undefined ? [] : [pair('rows', String(query.rows))]),
  ];
}

/** SolrCore.getDiagrams: the documents in a diagram matching the query. */
/** The scope's filter, as a parameter: none for a scope with none. */
const scopeFilter = (scope: string | null): SolrParams => {
  // No key for an absent scope.
  const filter = SCOPE_FILTER[scope ?? ''];
  return filter ? [pair('fq', filter)] : [];
};

function diagramParams(query: DiagramQuery): SolrParams {
  return [
    ...scopeFilter(query.scope),
    ...speciesAndTypes(query),
    [
      'fq',
      `${query.includeInteractors ? 'diagramsWithInteractor' : 'diagrams'}:${String(query.diagram)}`,
    ],
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
function speciesWideParams(query: DiagramQuery): SolrParams {
  const species = query.species ?? [];
  const kept = species.filter((name) => name !== '' && name !== null);
  const types = query.types?.length ? speciesAndTypes({ types: query.types }) : [];
  return [
    ...scopeFilter(query.scope),
    ['fq', kept.length ? `fireworksSpecies:("${kept.join('" OR "')}")` : ''],
    ...types,
    ...paging(query),
    ['q', query.query],
  ];
}

/** A String parameter with a default: absent or one empty value is the default; several are joined. */
function singleString(values: string[], fallback: string) {
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
function diagramFlags(answer: SolrAnswer | null, pathway: string, field: string) {
  const occurrences = new JavaHashMap<string, boolean>();
  const interactsWith = new JavaHashMap<string, boolean>();
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
function speciesWideFlags(answer: SolrAnswer | null, abbreviation: string | null) {
  const llps = new JavaHashMap<string, boolean>();
  const interactsWith = new JavaHashMap<string, boolean>();
  for (const doc of answer?.response?.docs ?? []) {
    for (const id of solrStrings(doc, 'llps')) llps.set(id, true);
    for (const raw of solrStrings(doc, 'occurrences')) {
      // fireworksFlagging reads [0], then [3].
      const line = fourParts(raw, ':', [0, 3]);
      if (line[3] !== '#') interactsWith.set(line[0], true);
    }
  }
  if (llps.size && interactsWith.size) for (const id of llps.keys()) interactsWith.delete(id);
  // A species without an abbreviation is 'R-null', as Java concatenates it.
  const prefix = `R-${String(abbreviation)}`;
  const kept = (map: JavaHashMap<string, boolean>) =>
    hashSetOf([...map.keys()].filter((id) => id.startsWith(prefix)));
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
function speciesToString(row: { dbId: number; displayName: string | null }) {
  return `Species {dbId=${row.dbId}, displayName='${row.displayName}'}`;
}

export const searchDiagramEndpoints: Endpoint[] = [
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
          const ask = async (scope: string | null) => {
            const answer = await solr(
              '/diagrams/occurrences',
              [...scopeFilter(scope), ['q', instance], ['fl', field]],
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
        // Java's envelope, as javaError wrote it.
        const envelope = JSON.parse(missing.body) as Record<string, unknown>;
        envelope['targets'] = targets;
        return { ...missing, body: javaJson(envelope) };
      });
    },
  },
];
