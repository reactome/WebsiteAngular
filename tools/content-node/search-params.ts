/**
 * What the search endpoints ask Solr, built as search-core's SolrCore builds
 * it (spec 014, research R1 layer 6): the parameters, the scope filters, the
 * Field names a query may ask for, and the diagram a search result is placed
 * in. Moved unchanged from service.ts.
 */
import { inDepthId } from './objects.ts';
import { read } from './graph.ts';
import neo4j from 'neo4j-driver';
import type { Bound } from './spring.ts';
import { javaTrim, present } from './java-text.ts';

/** DIAGRAM_RESULT_*: the diagram an event is drawn in, and where. */
type DiagramResult = {
  diagramStId: string;
  events: string[];
  width: number | null;
  height: number | null;
  // null when the diagram is a top-level pathway (the depth's OPTIONAL MATCH).
  level: number | null;
};

/**
 * graph-core's DiagramRepository.getDiagramResult, as DiagramService picks
 * it: by stable id or by dbId as getIdentifier reads the id (REACT_ ids
 * translated), else none. The diagram that draws the event, and the events
 * to select there: none for a pathway with a diagram of its own, a
 * subpathway's reactions, or the reaction itself.
 */
export async function diagramResult(raw: string) {
  const id = inDepthId(raw);
  if (!id) return undefined;
  let { idType, id: value } = id;
  if (idType === 'oldStId') {
    const [old] = await read<{ stId: string | null }>(
      'MATCH (n:DatabaseObject) WHERE n.oldStId = $id RETURN n.stId AS stId LIMIT 1',
      { id: value }
    );
    value = old?.stId ?? value;
    idType = 'stId';
  }
  const rows = await read<DiagramResult>(
    idType === 'dbId' ? DIAGRAM_RESULT_BY_DBID : DIAGRAM_RESULT_BY_STID,
    idType === 'dbId' ? { dbId: neo4j.int(value) } : { stId: value }
  );
  return rows[0];
}

const DIAGRAM_RESULT_BY_STID =
  'MATCH (d:Pathway{stId:$stId, hasDiagram:true}) RETURN d.stId AS diagramStId, [] AS events, d.diagramWidth AS width, d.diagramHeight AS height, 1 AS level UNION MATCH path=(d:Pathway{hasDiagram:true})-[:hasEvent*1..100]->(s:Pathway{stId:$stId, hasDiagram:false}) WHERE single(x IN nodes(path) WHERE (x:Pathway) AND x.hasDiagram) OPTIONAL MATCH aux=(s)-[:hasEvent*1..100]->(rle:ReactionLikeEvent) WHERE none(x IN nodes(aux) WHERE (x:Pathway) AND x.hasDiagram) WITH DISTINCT d, s, collect(DISTINCT rle.stId) AS events OPTIONAL MATCH depth=shortestPath((tlp:TopLevelPathway)-[:hasEvent*1..100]->(d)) WHERE NOT (d:TopLevelPathway) RETURN d.stId AS diagramStId, events, d.diagramWidth AS width, d.diagramHeight AS height, size(nodes(depth)) AS level ORDER BY level LIMIT 1 UNION MATCH path=(d:Pathway{hasDiagram:true})-[:hasEvent*1..100]->(r:ReactionLikeEvent{stId:$stId}) WHERE single(x IN nodes(path) WHERE (x:Pathway) AND x.hasDiagram) WITH DISTINCT d, r OPTIONAL MATCH depth=shortestPath((tlp:TopLevelPathway)-[:hasEvent*1..100]->(d)) WHERE NOT (d:TopLevelPathway) RETURN d.stId AS diagramStId, [r.stId] AS events, d.diagramWidth AS width, d.diagramHeight AS height, size(nodes(depth)) AS level ORDER BY level LIMIT 1';

const DIAGRAM_RESULT_BY_DBID =
  'MATCH (d:Pathway{dbId:$dbId, hasDiagram:true}) RETURN d.stId AS diagramStId, [] AS events, d.diagramWidth AS width, d.diagramHeight AS height, 1 AS level UNION MATCH path=(d:Pathway{hasDiagram:true})-[:hasEvent*]->(s:Pathway{dbId:$dbId, hasDiagram:false}) WHERE single(x IN nodes(path) WHERE (x:Pathway) AND x.hasDiagram) OPTIONAL MATCH aux=(s)-[:hasEvent*]->(rle:ReactionLikeEvent) WHERE none(x IN nodes(aux) WHERE (x:Pathway) AND x.hasDiagram) WITH DISTINCT d, s, collect(DISTINCT rle.stId) AS events OPTIONAL MATCH depth=shortestPath((tlp:TopLevelPathway)-[:hasEvent*]->(d)) WHERE NOT (d:TopLevelPathway) RETURN d.stId AS diagramStId, events, d.diagramWidth AS width, d.diagramHeight AS height, size(nodes(depth)) AS level ORDER BY level LIMIT 1 UNION MATCH path=(d:Pathway{hasDiagram:true})-[:hasEvent*]->(r:ReactionLikeEvent{dbId:$dbId}) WHERE single(x IN nodes(path) WHERE (x:Pathway) AND x.hasDiagram) WITH DISTINCT d, r OPTIONAL MATCH depth=shortestPath((tlp:TopLevelPathway)-[:hasEvent*]->(d)) WHERE NOT (d:TopLevelPathway) RETURN d.stId AS diagramStId, [r.stId] AS events, d.diagramWidth AS width, d.diagramHeight AS height, size(nodes(depth)) AS level ORDER BY level LIMIT 1';

/** SolrCore.configureScope's filter for each scope; BOTH has none. */
/** Solr's parameters, in order, as solr() sends them. */
export type SolrParams = [string, string][];

/**
 * One parameter, typed as solr() takes it: an array literal spread from a
 * conditional is not typed by where it lands, so a bare pair there reads as
 * string[].
 */
export function pair(name: string, value: string): [string, string] {
  return [name, value];
}

export const SCOPE_FILTER = {
  REFERENCE_ENTITY: 'hasReferenceEntity:false',
  PHYSICAL_ENTITY: '-isReferenceSummary:true',
};

/** search-core's ParserType: the defType each sends, STD none. */
export const PARSER_TYPES = { DISMAX: 'dismax', EDISMAX: 'edismax', STD: '' };

/** search-core's SolrConverter.Field: each constant's name, and the Solr field it names. */
const SOLR_FIELDS = {
  DB_ID: 'dbId',
  ST_ID: 'stId',
  PHYSICAL_ENTITIES_DB_ID: 'physicalEntitiesDbId',
  NAME: 'name',
  SPECIES: 'species',
  SPECIES_FACET: 'species_facet',
  TYPES: 'type_facet',
  KEYWORDS: 'keywords_facet',
  COMPARTMENT_FACET: 'compartment_facet',
  ICON_CATEGORIES_FACET: 'iconCategories_facet',
  SUMMATION: 'summation',
  INFERRED_SUMMATION: 'inferredSummation',
  REFERENCE_URL: 'referenceURL',
  REFERENCE_NAME: 'referenceName',
  REFERENCE_IDENTIFIERS: 'referenceIdentifiers',
  IS_DISEASE: 'isDisease',
  TYPE: 'type',
  IS_REFERENCE_SUMMARY: 'isReferenceSummary',
  HAS_REFERENCE_ENTITY: 'hasReferenceEntity',
  HAS_EHLD: 'hasEHLD',
  EXACT_TYPE: 'exactType',
  DATABASE_NAME: 'databaseName',
  REGULATOR: 'regulator',
  REGULATOR_ID: 'regulatorId',
  REGULATED_ENTITY: 'regulatedEntity',
  REGULATED_ENTITY_ID: 'regulatedEntityId',
  COMPARTMENT_NAME: 'compartmentName',
  COMPARTMENT_ACCESSION: 'compartmentAccession',
  FIREWORKS_SPECIES: 'fireworksSpecies',
  OCCURRENCES: 'occurrences',
  OCCURRENCES_INTERACTOR: 'occurrencesWithInteractor',
  DIAGRAMS: 'diagrams',
  DIAGRAMS_INTERACTOR: 'diagramsWithInteractor',
  LLPS: 'llps',
  AUTHORED_PATHWAYS: 'authoredPathways',
  AUTHORED_REACTIONS: 'authoredReactions',
  REVIEWED_PATHWAYS: 'reviewedPathways',
  REVIEWED_REACTIONS: 'reviewedReactions',
  ORCIDID: 'orcidId',
  TARGET_IDENTIFIER: 'identifier',
  TARGET_ACCESSIONS: 'accessions',
  TARGET_GENENAMES: 'geneNames',
  TARGET_SYNONYMS: 'synonyms',
  TARGET_RESOURCE: 'resource',
  ICON_NAME: 'iconName',
  ICON_CATEGORIES: 'iconCategories',
  ICON_CURATOR_NAME: 'iconCuratorName',
  ICON_CURATOR_ORCIDID: 'iconCuratorOrcidId',
  ICON_CURATOR_URL: 'iconCuratorUrl',
  ICON_DESIGNER_NAME: 'iconDesignerName',
  ICON_DESIGNER_URL: 'iconDesignerUrl',
  ICON_DESIGNER_ORCIDID: 'iconDesignerOrcidId',
  ICON_REFERENCES: 'iconReferences',
  ICON_PHYSICAL_ENTITIES: 'iconPhysicalEntities',
  ICON_EHLDS: 'iconEhlds',
  DELETED: 'deleted',
  DELETED_REASON: 'deletedReason',
  DELETED_EXPLANATION: 'explanation',
  DELETED_DATE: 'date',
  DELETED_REPLACEMENT_DB_IDS: 'replacementDbIds',
  DELETED_REPLACEMENT_ST_IDS: 'replacementStIds',
};

/**
 * `fields`, a List of SolrConverter.Field, as Spring binds it, measured:
 * absent is null; one value is split at commas, several are taken as they
 * are; each is trimmed, and one empty once trimmed is null (Java fails on
 * it later, once the entity's document is found). A name that is no constant is
 * the 400, quoting the element as sent and naming the constant trimmed.
 */
export function springFields(values: string[]): Bound<(string | null)[] | null> {
  if (values.length === 0) return { value: null };
  if (values.length === 1 && values[0] === '') return { value: [] };
  const elements = values.length === 1 ? present(values[0]).split(',') : values;
  const fields: (string | null)[] = [];
  for (const element of elements) {
    const name = javaTrim(element);
    // Empty once trimmed converts to null, which Java fails on later.
    if (name === '') {
      fields.push(null);
      continue;
    }
    if (!Object.hasOwn(SOLR_FIELDS, name)) {
      const type = values.length > 1 ? 'java.lang.String[]' : 'java.lang.String';
      return {
        error:
          `Failed to convert value of type '${type}' to required type 'java.util.List'; nested exception is ` +
          'org.springframework.core.convert.ConversionFailedException: Failed to convert from type [java.lang.String] ' +
          'to type [@io.swagger.v3.oas.annotations.Parameter @org.springframework.web.bind.annotation.RequestParam ' +
          `org.reactome.server.search.solr.SolrConverter$Field] for value '${element}'; nested exception is ` +
          `java.lang.IllegalArgumentException: No enum constant org.reactome.server.search.solr.SolrConverter.Field.${name}`,
      };
    }
    fields.push(SOLR_FIELDS[name]);
  }
  return { value: fields };
}

/** SolrCore.getFilterString without a tag: "" for no list, as Java sends it. */
function plainFilter(list, field) {
  if (!list) return '';
  const kept = list.filter((name) => name !== '' && name !== null);
  list.splice(0, list.length, ...kept);
  return kept.length ? `${field}:("${kept.join('" OR "')}")` : '';
}

/**
 * SolrCore.initQuery for /search and /search/grouped: a filter for each list
 * (empty when there is none -- Java sends those too), deleted or not, the
 * scope, the parser.
 */
export function searchParams(query): SolrParams {
  return [
    ['fq', plainFilter(query.species, 'species_facet')],
    ['fq', plainFilter(query.types, 'type_facet')],
    ['fq', plainFilter(query.compartments, 'compartment_facet')],
    ['fq', plainFilter(query.keywords, 'keywords_facet')],
    ['fq', query.deleted ? 'deleted:true' : '-deleted'],
    ...(SCOPE_FILTER[query.scope] ? [pair('fq', SCOPE_FILTER[query.scope])] : []),
    ...(PARSER_TYPES[query.parserType] ? [pair('defType', PARSER_TYPES[query.parserType])] : []),
  ];
}
