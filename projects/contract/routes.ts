// The content service's routes whose answers the contract describes: each
// "METHOD /path", as the registry has it, to the answer it writes with a 200
// (spec 016, contracts/module.md). The description is generated from this
// (tools/contract/generate.ts); a route the registry has and this does not
// is listed there as not yet in the contract.
import type { PathwayCitation } from './citation.ts';
import type { JsogReference } from './graph.ts';
import type { Disease, Species } from './graph.ts';
import type {
  AnyPathway,
  Event,
  GraphObject,
  PhysicalEntity,
  ReactionLikeEvent,
  ReferenceEntity,
  TopLevelPathway,
} from './graph-core.ts';
import type {
  Contributor,
  DoiPathway,
  BareSpecies,
  ComponentOfEntry,
  DiscoverDataset,
  EventProjection,
  InstanceReferrals,
  SchemaAttribute,
  SchemaNode,
  SimpleDatabaseObject,
  TocPathway,
} from './content.ts';
import type {
  CustomInteraction,
  InteractionWithEntities,
  Interactors,
  PsicquicResource,
} from './interactors.ts';
import type { ExpressionAnswer } from './expression.ts';
import type { EventsHierarchyNode } from './events-hierarchy.ts';
import type { PathwayBrowserNode } from './locations.ts';
import type { Participant } from './participants.ts';
import type { SimpleEvent } from './person.ts';
import type { ReactionLayout } from './reaction-layout.ts';
import type {
  DiagramFlagResult,
  DiagramResult,
  FacetResponse,
  GroupedResult,
  IconEntry,
  IconFacetResponse,
  IconResult,
  PathwayOfEntry,
  SearchEntry,
  SpeciesOverviewFlagResult,
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
  'GET /ContentService/data/query/enhanced/v2/{id}': GraphObject<JsogReference>;
  'GET /ContentService/data/query/{id}/more': GraphObject<JsogReference>;
  'GET /ContentService/data/detail/{id}/locationsInPWB': PathwayBrowserNode[];
  'GET /ContentService/data/eventsHierarchy/{id}': EventsHierarchyNode[];
  'GET /ContentService/data/participants/{id}': Participant[];
  'GET /ContentService/data/person/{id}/authoredPathways': SimpleEvent[];
  'GET /ContentService/data/person/{id}/authoredReactions': SimpleEvent[];
  'GET /ContentService/data/person/{id}/reviewedPathways': SimpleEvent[];
  'GET /ContentService/data/person/{id}/reviewedReactions': SimpleEvent[];
  'GET /ContentService/citation/pathway/{id}': PathwayCitation;
  'GET /ContentService/exporter/reaction/{id}/diagram': ReactionLayout;
  'GET /ContentService/interactors/static/molecule/{id}/details': Interactors;
  'POST /ContentService/interactors/static/molecules/details': Interactors;
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
  'GET /ContentService/search/diagram/{pathwayId}/flag': DiagramFlagResult;
  'GET /ContentService/search/fireworks/flag': SpeciesOverviewFlagResult;
  'GET /ContentService/expression/{id}': ExpressionAnswer;
  // The routes the release check asks (spec 032, T032). Outside the enhanced
  // query a related object already written is referred to by its dbId.
  'GET /ContentService/data/species/main': Species<number>[];
  'GET /ContentService/data/species/all': (Species<number> | BareSpecies)[];
  'GET /ContentService/data/pathways/top/{id}': TopLevelPathway<number>[];
  'GET /ContentService/data/query/{id}': GraphObject<number>;
  'GET /ContentService/data/discover/{id}': DiscoverDataset;
  'GET /ContentService/data/event/{id}/ancestors': EventProjection[][];
  // An event already written in the list appears again as its dbId.
  'GET /ContentService/data/pathway/{id}/containedEvents': (Event<number> | number)[];
  'GET /ContentService/data/participants/{id}/participatingPhysicalEntities': PhysicalEntity<number>[];
  'GET /ContentService/data/participants/{id}/referenceEntities': ReferenceEntity<number>[];
  'GET /ContentService/data/complex/{id}/subunits': PhysicalEntity<number>[];
  'GET /ContentService/data/entity/{id}/componentOf': ComponentOfEntry[];
  'GET /ContentService/data/entity/{id}/otherForms': PhysicalEntity<number>[];
  'GET /ContentService/data/pathways/low/entity/{id}': AnyPathway<number>[];
  'GET /ContentService/data/pathways/low/diagram/entity/{id}': AnyPathway<number>[];
  'GET /ContentService/data/mapping/{resource}/{identifier}/pathways': AnyPathway<number>[];
  'GET /ContentService/data/mapping/{resource}/{identifier}/reactions': ReactionLikeEvent<number>[];
  'GET /ContentService/data/diseases': Disease<number>[];
  'GET /ContentService/interactors/static/molecule/{id}/summary': Interactors;
  'GET /ContentService/references/mapping/{identifier}': ReferenceEntity<number>[];
}
