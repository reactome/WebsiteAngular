/**
 * The search endpoints (spec 014, research R1, a family): /search/query and
 * its paginated form, the facets, suggest and spellcheck, the icons and the
 * pathways an object is in, with the helpers only they use. Moved unchanged
 * from service.ts.
 */
import type { Endpoint, Request } from './endpoint.ts';
import type { SolrAnswer, SolrGrouping } from './solr.ts';
import type { Written } from './answers.ts';
import type { FacetContainer, TargetResult } from './search-core.ts';
import {
  blankBoolean,
  facetContainer,
  fromSolr,
  rawOccurrence,
  reportInformation,
  reportNotFound,
  searchEntry,
  solrStrings,
  targetsOf,
} from './search-core.ts';
import { PARSER_TYPES, SCOPE_FILTER, pair, searchParams, springFields } from './search-params.ts';
import type { SearchQuery } from './search-params.ts';
import { solr } from './solr.ts';
import { javaError, javaJson, notFound, unexpectedFailure } from './answers.ts';
import {
  pathId,
  queryValues,
  rawSegment,
  requiredString,
  springBoolean,
  springEnum,
  springInteger,
  springIntegerWithDefault,
  springList,
  springPathLong,
  springScope,
} from './spring.ts';
import { present } from './java-text.ts';

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
  const scope = SCOPE_FILTER[query.scope];
  if (scope) params.push(['fq', scope]);
  for (const [list, tag, field] of QUERY_FILTERS) {
    const given = query[list];
    if (!given || given.length === 0) continue;
    const kept = given.filter((name) => name !== '' && name !== null);
    given.splice(0, given.length, ...kept);
    params.push(['fq', kept.length ? `${tag}${field}:("${kept.join('" OR "')}")` : tag]);
  }
  params.push(['fq', query.deleted ? 'deleted:true' : '-deleted']);
  const parser = PARSER_TYPES[query.parserType];
  if (parser) params.push(['defType', parser]);
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
async function searchFor(query: SearchQuery, { rowCount, page, grouped, force, request, signal }) {
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
function searchAnswer(request: Request, query, result) {
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

export const searchEndpoints: Endpoint[] = [
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
