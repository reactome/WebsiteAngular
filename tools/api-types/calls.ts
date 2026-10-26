/**
 * Every place the site asks the content API for something, the route it
 * calls, and the type it reads the answer as (spec 012, research R1).
 *
 * calls.spec.ts keeps this table and the source in step: a call the source
 * makes that is not here fails, as does an entry the source no longer has.
 * content.spec.ts compiles every recorded answer of each route as the type
 * here, so this is also where a type is chosen for an answer.
 *
 *   file, method, n  where: the method or property the call is in, and which
 *                    of its calls (1 unless a method makes several)
 *   http             GET, POST, or FETCH
 *   route            under /ContentService; {x} matches one path segment; a
 *                    list where one call chooses between routes
 *   query            query values that pick this reader over others of the
 *                    same route that name none (the pathway browser's icon
 *                    search); null for a parameter the call never sends
 *   type             the type the answer is compiled as, written as in
 *                    TypeScript, with its names from TYPES; 'text' and 'blob'
 *                    answers are listed and not compiled
 *   reads            what the source reads the answer as, where that is a
 *                    type parameter the caller chooses (`T`, `E`): `type` is
 *                    then the most the source promises for every caller, and
 *                    the call table check compares `reads` with the source
 *   gap              why no recorded answer covers it; the check fails if one
 *                    does, so the table cannot fall behind the recordings
 *   indirect         the URL comes from outside the file (a profile setting,
 *                    a caller), so the scan cannot see it; checked by name
 */

/** One place the site asks the content API for something (see above). */
export interface Call {
  file: string;
  method: string;
  n?: number;
  http: 'GET' | 'POST' | 'FETCH';
  route: string | string[];
  query?: Record<string, string | null>;
  type: string;
  reads?: string;
  gap?: string;
  indirect?: string;
}

/** Where a call is, as the checks name it: file, method, and which of its calls. */
export const where = (c: { file: string; method: string; n?: number }): string =>
  `${c.file} › ${c.method}${(c.n ?? 1) > 1 ? ` #${c.n}` : ''}`;

const PB = 'projects/pathway-browser/src/app';
const WEB = 'projects/website-angular/src';

/** Where each name a type uses comes from, repository-relative, without extension. */
export const TYPES: Record<string, string> = {
  DatabaseObject: `${PB}/model/graph/database-object.model`,
  Pathway: `${PB}/model/graph/event/pathway.model`,
  TopLevelPathway: `${PB}/model/graph/event/top-level-pathway.model`,
  Event: `${PB}/model/graph/event/event.model`,
  SelectableObject: `${PB}/services/event.service`,
  Species: `${PB}/model/graph/species.model`,
  PhysicalEntity: `${PB}/model/graph/physical-entity/physical-entity.model`,
  ReferenceEntity: `${PB}/model/graph/reference-entity/reference-entity.model`,
  Participant: `${PB}/model/participant.model`,
  PathwayCitation: `${PB}/model/citation.model`,
  DiagramFlagResult: `${PB}/model/flag.model`,
  SpeciesOverviewFlagResult: `${PB}/model/flag.model`,
  ReactionJson: `${PB}/model/reaction-diagram.model`,
  ReferenceEntityIds: `${PB}/model/popup.model`,
  Search: `${PB}/model/search.model`,
  EventsHierarchy: `${PB}/model/events-hierarchy.model`,
  Interactors: `${PB}/interactors/model/interactor.model`,
  CustomInteraction: `${PB}/interactors/model/interactor.model`,
  PsicquicResource: `${PB}/interactors/model/interactor.model`,
  InteractorToken: `${PB}/interactors/model/interactor.model`,
  SearchResult: `${WEB}/model/search.model`,
  FacetResponse: 'projects/contract/search',
  IconFacetResponse: 'projects/contract/search',
  IconResult: `${WEB}/model/icon.model`,
  IconEntry: `${WEB}/model/icon.model`,
  SchemaNode: `${WEB}/model/content.model`,
  TocPathway: `${WEB}/model/content.model`,
  DoiPathway: `${WEB}/model/content.model`,
  Contributor: `${WEB}/model/content.model`,
  SchemaAttribute: `${WEB}/model/content.model`,
  SimpleDatabaseObject: `${WEB}/model/content.model`,
  InstanceReferrals: `${WEB}/model/content.model`,
  Person: `${WEB}/model/person.model`,
  SimpleEvent: `${WEB}/model/person.model`,
  PathwayBrowserNode: `${WEB}/model/locations.model`,
  InteractionWithEntities: `${WEB}/model/interactor.model`,
};

const UPLOAD = 'an upload is stored for good, so none is recorded';

// One call per line reads as a table.
// prettier-ignore
export const CALLS: Call[] = [
  // pathway-browser
  { file: `${PB}/details/common/reaction-diagram/reaction-diagram.component.ts`, method: 'ngAfterViewInit', http: 'GET', route: '/exporter/reaction/{id}/diagram', type: 'ReactionJson' },
  { file: `${PB}/diagram/entity-popup/entity-popup.component.ts`, method: 'molecules', http: 'GET', route: '/data/query/enhanced/{id}', type: 'any' },
  { file: `${PB}/diagram/entity-popup/entity-popup.component.ts`, method: 'molecules', n: 2, http: 'GET', route: '/data/query/{id}', type: 'any' },
  { file: `${PB}/diagram/entity-popup/entity-popup.component.ts`, method: 'annotated', http: 'GET', route: '/data/participants/{id}/referenceEntities', type: 'ReferenceEntityIds[]' },
  { file: `${PB}/diagram/entity-popup/entity-popup.component.ts`, method: 'pathways', http: 'GET', route: '/data/pathways/low/entity/{id}', type: '{ stId: string; displayName: string; speciesName: string; hasDiagram?: boolean }[]' },
  { file: `${PB}/diagram/entity-popup/entity-popup.component.ts`, method: 'interactors', http: 'GET', route: '/interactors/static/molecule/{acc}/details', type: 'any', gap: 'the recordings never open an interactor popup' },
  { file: `${PB}/interactors/services/interactor.service.ts`, method: 'fetchInteractorData', http: 'POST', route: ['/interactors/static/molecules/details', '/interactors/psicquic/molecules/{resource}/details'], type: 'Interactors' },
  { file: `${PB}/interactors/services/interactor.service.ts`, method: 'getCustomInteractorsByAcc', http: 'GET', route: '/interactors/static/molecule/enhanced/{acc}/details', type: 'CustomInteraction[]' },
  { file: `${PB}/interactors/services/interactor.service.ts`, method: 'getPsicquicResources', http: 'GET', route: '/interactors/psicquic/resources', type: 'PsicquicResource[]' },
  { file: `${PB}/interactors/services/interactor.service.ts`, method: 'getInteractorsToken', http: 'POST', route: '/interactors/upload/{kind}/{source}', type: 'InteractorToken', gap: UPLOAD },
  { file: `${PB}/interactors/services/interactor.service.ts`, method: 'fetchCustomInteractors', http: 'POST', route: '/interactors/token/{token}', type: 'Interactors', gap: UPLOAD },
  { file: `${PB}/reacfoam/reacfoam.service.ts`, method: 'fetchEventsHierarchy', http: 'GET', route: '/data/eventsHierarchy/{taxId}', type: 'EventsHierarchy.Data[]' },
  { file: `${PB}/services/citation.service.ts`, method: 'getCitation', http: 'GET', route: '/citation/static/{id}', type: 'text' },
  { file: `${PB}/services/citation.service.ts`, method: 'getCitation', n: 2, http: 'GET', route: '/citation/pathway/{id}', type: 'PathwayCitation', gap: 'the recordings never cite a pathway' },
  { file: `${PB}/services/data-state.service.ts`, method: 'getReacfoamFlagging', http: 'GET', route: '/search/fireworks/flag', type: 'SpeciesOverviewFlagResult', gap: 'recorded only as aborted requests' },
  { file: `${PB}/services/data-state.service.ts`, method: 'getDiagramFlagging', http: 'GET', route: '/search/diagram/{id}/flag', type: 'DiagramFlagResult' },
  { file: `${PB}/services/data-state.service.ts`, method: 'fetchEnhancedData', http: 'GET', route: '/data/query/enhanced/v2/{id}', type: 'DatabaseObject', reads: 'T' },
  { file: `${PB}/services/data-state.service.ts`, method: 'fetchAncestors', http: 'GET', route: '/data/event/{id}/ancestors', query: { includeRef: 'true' }, type: 'Pathway[][]' },
  { file: `${PB}/services/database-object.service.ts`, method: 'fetchSimpleData', http: 'GET', route: '/data/query/{id}', type: 'DatabaseObject', reads: 'T' },
  { file: `${PB}/services/database-object.service.ts`, method: 'fetchEnhancedEntry', http: 'GET', route: '/data/query/enhanced/v2/{id}', type: 'DatabaseObject', reads: 'T' },
  { file: `${PB}/services/diagram.service.ts`, method: 'getNormalPathway', http: 'GET', route: '/data/query/{id}/normalPathway', type: 'text' },
  { file: `${PB}/services/entity.service.ts`, method: 'getOtherForms', http: 'GET', route: '/data/entity/{id}/otherForms', type: 'PhysicalEntity[]' },
  { file: `${PB}/services/entity.service.ts`, method: 'getParticipatingPathways', http: 'GET', route: '/data/pathways/low/entity/{id}', type: 'Pathway[]' },
  { file: `${PB}/services/entity.service.ts`, method: 'getEntityInDepth', http: 'GET', route: '/data/entity/{id}/in-depth', type: 'DatabaseObject | null', reads: 'E | null', gap: 'never recorded' },
  { file: `${PB}/services/entity.service.ts`, method: 'getEventInDepth', http: 'GET', route: '/data/event/{id}/in-depth', type: 'DatabaseObject', reads: 'E', gap: 'never recorded' },
  { file: `${PB}/services/event.service.ts`, method: 'fetchTlpsBySpecies', http: 'GET', route: '/data/pathways/top/{taxId}', type: 'TopLevelPathway[]' },
  { file: `${PB}/services/event.service.ts`, method: 'fetchEventAncestors', http: 'GET', route: '/data/event/{id}/ancestors', query: { includeRef: null }, type: 'Pathway[][]' },
  { file: `${PB}/services/general.service.ts`, method: 'version', http: 'GET', route: '/data/database/version', type: 'number' },
  { file: `${PB}/services/general.service.ts`, method: 'version', n: 2, http: 'GET', route: '/data/database/version', type: 'number', indirect: 'another deployment, named by the profile' },
  { file: `${PB}/services/icon.service.ts`, method: 'fetchIcon', http: 'GET', route: '/search/query', query: { types: 'Icon' }, type: 'Search.Icon.Result' },
  { file: `${PB}/services/participant.service.ts`, method: 'getParticipants', http: 'GET', route: '/data/participants/{id}', type: 'Participant[]' },
  { file: `${PB}/services/participant.service.ts`, method: 'getReferenceEntities', http: 'GET', route: '/data/participants/{id}/referenceEntities', type: 'ReferenceEntity[]' },
  { file: `${PB}/services/species.service.ts`, method: 'allSpecies', http: 'GET', route: '/data/species/main', type: 'Species[]' },
  { file: `${PB}/services/species.service.ts`, method: 'getOrtholog', http: 'GET', route: '/data/orthology/{id}/species/{dbId}', type: 'Event', gap: 'its reader has no callers' },
  { file: `${PB}/services/species.service.ts`, method: 'getOrthologousMap', http: 'POST', route: '/data/orthologies/ids/species/{dbId}', type: '{ [p: string]: SelectableObject }' },
  { file: `${PB}/services/url-state.service.ts`, method: 'dbIdToStId', http: 'GET', route: '/data/query/{id}/stId', type: 'text' },
  { file: `${PB}/services/file-download.service.ts`, method: 'start', http: 'GET', route: '/exporter/{kind}/{file}', type: 'blob', indirect: 'the download URL is its caller’s' },
  { file: `${PB}/viewport/search/search.component.ts`, method: 'suggestions', http: 'GET', route: '/search/suggest', type: 'string[]' },
  { file: `${PB}/viewport/search/search.component.ts`, method: 'scopes', http: 'GET', route: '/search/diagram/{id}', type: 'Search.Result' },
  { file: `${PB}/viewport/search/search.component.ts`, method: 'scopes', n: 2, http: 'GET', route: '/search/fireworks', type: 'Search.Result' },
  { file: `${PB}/viewport/search/search.component.ts`, method: 'selectedResultPathways', http: 'GET', route: '/search/pathways/of/{dbId}', type: 'Search.PathwayOf[]' },

  // website-angular
  { file: `${WEB}/app/breadcrumb/breadcrumb.component.ts`, method: 'ngOnInit', http: 'GET', route: '/data/person/{id}', type: '{ displayName?: string }' },
  { file: `${WEB}/app/breadcrumb/breadcrumb.component.ts`, method: 'ngOnInit', n: 2, http: 'GET', route: '/data/query/{id}', type: '{ displayName?: string; name?: string[] }' },
  { file: `${WEB}/app/content/detail/interactor-detail/interactor-detail.component.ts`, method: 'ngOnInit', http: 'GET', route: '/interactors/static/molecule/{acc}/withEntities', type: 'InteractionWithEntities[]' },
  { file: `${WEB}/app/content/detail/interactor-detail/interactor-detail.component.ts`, method: 'ngOnInit', n: 2, http: 'GET', route: '/search/query', type: 'SearchResult' },
  { file: `${WEB}/app/content/detail/locations-tree/locations-tree.component.ts`, method: 'fetchLocations', http: 'GET', route: '/data/detail/{id}/locationsInPWB', type: 'PathwayBrowserNode[]' },
  { file: `${WEB}/app/content/detail/person-detail/person-detail.component.ts`, method: 'person', http: 'GET', route: '/data/person/{id}', type: 'Person' },
  { file: `${WEB}/app/content/detail/person-detail/person-detail.component.ts`, method: 'fetchEvents', http: 'GET', route: '/data/person/{id}/{list}', type: 'SimpleEvent[] | null' },
  { file: `${WEB}/app/content/detail/providers/detail-data-state.provider.ts`, method: 'fetchEnhancedData', http: 'GET', route: '/data/query/enhanced/v2/{id}', type: 'DatabaseObject', reads: 'T' },
  { file: `${WEB}/app/content/detail/providers/detail-entity.provider.ts`, method: 'getOtherForms', http: 'GET', route: '/data/entity/{id}/otherForms', type: 'PhysicalEntity[]' },
  { file: `${WEB}/app/content/detail/providers/detail-entity.provider.ts`, method: 'getParticipatingPathways', http: 'GET', route: '/data/pathways/low/entity/{id}', type: 'Pathway[]' },
  { file: `${WEB}/app/content/detail/providers/detail-entity.provider.ts`, method: 'getEntityInDepth', http: 'GET', route: '/data/entity/{id}/in-depth', type: 'DatabaseObject | null', reads: 'E | null', gap: 'never recorded' },
  { file: `${WEB}/app/content/detail/providers/detail-entity.provider.ts`, method: 'getEventInDepth', http: 'GET', route: '/data/event/{id}/in-depth', type: 'DatabaseObject', reads: 'E', gap: 'never recorded' },
  { file: `${WEB}/app/content/detail/providers/detail-interactor.provider.ts`, method: 'getCustomInteractorsByAcc', http: 'GET', route: '/interactors/static/molecule/enhanced/{acc}/details', type: 'CustomInteraction[]' },
  { file: `${WEB}/app/idg/idg.service.ts`, method: 'detail', http: 'GET', route: '/data/query/enhanced/{id}', type: '{ summation?: { text?: string }[] }' },
  { file: `${WEB}/app/idg/idg.service.ts`, method: 'ancestors', http: 'GET', route: '/data/event/{id}/ancestors', query: { includeRef: null }, type: '{ stId: string; displayName: string }[][]' },
  { file: `${WEB}/services/content-data.service.ts`, method: 'fetchModel', http: 'GET', route: '/data/schema/model', type: 'SchemaNode', reads: 'T' },
  { file: `${WEB}/services/content-data.service.ts`, method: 'getTocPathways', http: 'GET', route: '/data/content/toc', type: 'TocPathway[]' },
  { file: `${WEB}/services/content-data.service.ts`, method: 'getDoiPathways', http: 'GET', route: '/data/content/doi', type: 'DoiPathway[]' },
  { file: `${WEB}/services/content-data.service.ts`, method: 'getContributors', http: 'GET', route: '/data/content/contributors', type: 'Contributor[]' },
  { file: `${WEB}/services/content-data.service.ts`, method: 'getSchemaAttributes', http: 'GET', route: '/data/schema/{class}/attributes', type: 'SchemaAttribute[]' },
  { file: `${WEB}/services/content-data.service.ts`, method: 'getSchemaReferrals', http: 'GET', route: '/data/schema/{class}/referrals', type: 'SchemaAttribute[]' },
  { file: `${WEB}/services/content-data.service.ts`, method: 'getSchemaEntries', http: 'GET', route: '/data/schema/{class}/min', type: 'SimpleDatabaseObject[]', gap: 'the recordings never open a class’s instances' },
  { file: `${WEB}/services/content-data.service.ts`, method: 'getSchemaCount', http: 'GET', route: '/data/schema/{class}/count', type: 'number' },
  { file: `${WEB}/services/content-data.service.ts`, method: 'getInstance', http: 'GET', route: '/data/query/enhanced/{id}', type: 'any' },
  { file: `${WEB}/services/content-data.service.ts`, method: 'getInstanceReferrers', http: 'GET', route: '/data/instance/{id}/referrers', type: 'InstanceReferrals[]', gap: 'the recordings never open an instance’s referrers' },
  { file: `${WEB}/services/detail-data.service.ts`, method: 'fetchEnhancedData', http: 'GET', route: '/data/query/enhanced/v2/{id}', type: 'DatabaseObject', reads: 'T' },
  { file: `${WEB}/services/icon.service.ts`, method: 'getFacets', http: 'GET', route: '/search/icon/facet', type: 'IconFacetResponse' },
  { file: `${WEB}/services/icon.service.ts`, method: 'queryIcons', http: 'GET', route: '/search/icon/query', type: 'IconResult' },
  { file: `${WEB}/services/icon.service.ts`, method: 'getIcon', http: 'GET', route: '/search/icon/{id}', type: 'IconEntry', gap: 'the recordings never open one icon' },
  { file: `${WEB}/services/search.service.ts`, method: 'search', http: 'GET', route: '/search/query', type: 'SearchResult' },
  { file: `${WEB}/services/search.service.ts`, method: 'getFacets', http: 'GET', route: '/search/facet_query', type: 'FacetResponse' },
  { file: `${WEB}/services/search.service.ts`, method: 'getAllFacets', http: 'GET', route: '/search/facet', type: 'FacetResponse', gap: 'the recordings always search with a query' },
  { file: `${WEB}/services/search.service.ts`, method: 'getSuggestedTerms', http: 'GET', route: '/search/suggest', type: 'string[]' },
  { file: `${WEB}/services/search.service.ts`, method: 'getSpellCheckTerms', http: 'GET', route: '/search/spellcheck', type: 'string[]' },
];
