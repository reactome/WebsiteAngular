// The content service's routes whose answers the contract describes: each
// "METHOD /path", as the registry has it, to the answer it writes with a 200
// (spec 016, contracts/module.md). The description is generated from this
// (tools/contract/generate.ts); a route the registry has and this does not
// is listed there as not yet in the contract.
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
