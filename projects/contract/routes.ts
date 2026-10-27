// The content service's routes whose answers the contract describes: each
// "METHOD /path", as the registry has it, to the answer it writes with a 200
// (spec 016, contracts/module.md). The description is generated from this
// (tools/contract/generate.ts); a route the registry has and this does not
// is listed there as not yet in the contract.
import type {
  Contributor,
  DoiPathway,
  InstanceReferrals,
  SchemaAttribute,
  SchemaNode,
  SimpleDatabaseObject,
  TocPathway,
} from './content.ts';
import type {
  CustomInteraction,
  InteractionWithEntities,
  PsicquicResource,
} from './interactors.ts';
import type {
  DiagramResult,
  FacetResponse,
  GroupedResult,
  IconEntry,
  IconFacetResponse,
  IconResult,
  PathwayOfEntry,
  SearchEntry,
} from './search.ts';

export interface Routes {
  'GET /ContentService/data/content/toc': TocPathway[];
  'GET /ContentService/data/content/doi': DoiPathway[];
  'GET /ContentService/data/content/contributors': Contributor[];
  'GET /ContentService/data/schema/model': SchemaNode;
  'GET /ContentService/data/schema/{id}/attributes': SchemaAttribute[];
  'GET /ContentService/data/schema/{id}/referrals': SchemaAttribute[];
  'GET /ContentService/data/schema/{id}/min': SimpleDatabaseObject[];
  'GET /ContentService/data/instance/{id}/referrers': InstanceReferrals[];
  'GET /ContentService/interactors/psicquic/resources': PsicquicResource[];
  'GET /ContentService/interactors/static/molecule/enhanced/{id}/details': CustomInteraction[];
  'GET /ContentService/interactors/static/molecule/{id}/withEntities': InteractionWithEntities[];
  'GET /ContentService/search/query': GroupedResult<SearchEntry>;
  'GET /ContentService/search/query/paginated': GroupedResult<SearchEntry>;
  'GET /ContentService/search/facet': FacetResponse;
  'GET /ContentService/search/facet_query': FacetResponse;
  'GET /ContentService/search/suggest': string[];
  'GET /ContentService/search/spellcheck': string[];
  'GET /ContentService/search/pathways/of/{dbId}': PathwayOfEntry[];
  'GET /ContentService/search/icon/facet': IconFacetResponse;
  'GET /ContentService/search/icon/query': IconResult;
  'GET /ContentService/search/icon/{identifier}': IconEntry;
  'GET /ContentService/search/diagram/{diagram}': DiagramResult<SearchEntry>;
  'GET /ContentService/search/fireworks': DiagramResult<SearchEntry>;
}
