/**
 * The pathway and event endpoints (spec 014, research R1, a family): the
 * top-level and lower-level pathways (/data/pathways/*), a pathway's
 * contained events (/data/pathway/*), an event's ancestors (/data/event/*),
 * the in-depth tree below an entity or an event
 * (/data/{entity,event}/{id}/in-depth) and where an object sits in the
 * Pathway Browser (/data/detail/*), with the helpers only they use. Moved
 * unchanged from service.ts.
 */
import type { Endpoint, Request } from './endpoint.ts';
import {
  javaError,
  javaJson,
  neo4jFailureMessage,
  nonEmptyJson,
  notFound,
  only,
  RawJson,
  unexpectedFailure,
} from './answers.ts';
import { analysisFigures, analysisSizes } from './analysis-sizes.ts';
import type { AnalysisFigures } from './analysis-sizes.ts';
import { settings } from './settings.ts';
import type { EventsHierarchyNode } from '../../projects/contract/events-hierarchy.ts';
import {
  asciiDigits,
  javaBase64Decode,
  javaNumeric,
  javaTrim,
  javaUtf8,
  tomcatHeader,
} from './java-text.ts';
import type { JsonWritten } from './answers.ts';
import type { PathwayBrowserNode as LocationNode } from '../../projects/contract/locations.ts';
import {
  attributeOf,
  findByIdFailure,
  graphCoreId,
  inDepthId,
  longPastRange,
  pathwayJson,
  resolveId,
  speciesFilter,
  speciesTaxId,
} from './objects.ts';
import { read } from './graph.ts';
import type { GraphNode, GraphRelationship } from './graph.ts';
import neo4j from 'neo4j-driver';
import { inDepthQuery, javaDouble, mapResult, mapResults, writeDomain } from './domain.ts';
import type { MappedRow } from './domain.ts';
import {
  pathId,
  queryValues,
  rawSegment,
  springBoolean,
  springIntWithDefault,
  springList,
  writerFor,
} from './spring.ts';
import type { Bound } from './spring.ts';
import type { Props } from './objects.ts';
import { JavaHashMap } from './java-hashmap.ts';
import { schemaClassOf } from './schema.ts';
import type { SimpleDatabaseObject } from '../../projects/contract/content.ts';

/** One step of locationsQuery: an event's fields, its labels, the edge's order. */
type LocationStep = [
  stId: string | null,
  displayName: string | null,
  hasDiagram: boolean | null,
  speciesName: string | null,
  schemaClass: string | null,
  labels: string[] | null,
  order: number | null,
];

// steps is null for the row with no path (its OPTIONAL MATCH found none).
type LocationsRow = { db: LocationStep; steps: LocationStep[] | null };

/**
 * graph-core's four locations queries (HierarchyRepository), by kind of id and
 * by `directParticipants`: Java's MATCH and expansion exactly, because the
 * paths come back in the order the plan expands them and parseHierarchy builds
 * the tree from that order.
 *
 * Only the RETURN differs, and only in shape. Java collects every path into one
 * record; for a small molecule that is one record of 94,690 paths, and the node
 * driver decodes a record that spans many network chunks byte by byte -- 32s
 * for an answer Java gives in 2.8s, and nothing at all within two minutes for
 * the largest. One row per path streams instead (7.6s for that one, against
 * Java's 7.0s). The step's labels are left out, as nothing but the root reads
 * them. Checked rather than assumed: the streamed rows and Java's collected
 * list were compared path for path over twelve ids, both relationship sets,
 * and agreed every time; the diff harness then compares the answers.
 */
export function locationsQuery(byDbId: boolean, directParticipants: boolean) {
  const match = byDbId
    ? 'MATCH (n:DatabaseObject{dbId:$dbId}) '
    : 'MATCH (n:DatabaseObject{stId:$stId}) ';
  const relationships = directParticipants
    ? 'regulatedBy|regulator|physicalEntity|catalystActivity|requiredInputComponent|diseaseEntity|entityFunctionalStatus|input|output|hasEvent'
    : 'regulatedBy|regulator|physicalEntity|requiredInputComponent|diseaseEntity|entityFunctionalStatus|activeUnit|catalystActivity|repeatedUnit|hasMember|hasCandidate|hasComponent|input|output|hasEvent|proteinMarker|RNAMarker';
  return (
    match +
    `OPTIONAL MATCH path=(n)<-[:${relationships}*]-() ` +
    'RETURN [n.stId, n.displayName, n.hasDiagram, n.speciesName, n.schemaClass, labels(n), 0] AS db, ' +
    '[rel IN relationships(path) | [startNode(rel).stId, startNode(rel).displayName, startNode(rel).hasDiagram, startNode(rel).speciesName, startNode(rel).schemaClass, null, rel.order]] AS steps'
  );
}

/**
 * An event as graph-core's EventProjection, written as Java writes it.
 *
 * Jackson's order: properties backed by a field of the same name, in the order
 * the fields are declared, then `inferred` and `inDisease`, whose getters do not
 * match their `isInferred` / `isInDisease` fields. Absent values are omitted,
 * except the ones the projection defaults: false for the flags, 0 for the
 * diagram size -- which is why a reaction says `"hasDiagram":false`.
 */
export function eventProjection(node: Props) {
  return {
    ...only(node, [
      'dbId',
      'displayName',
      'stId',
      'name',
      'stIdVersion',
      'oldStId',
      'schemaClass',
      'doi',
      'speciesName',
      'releaseDate',
      'releaseStatus',
    ]),
    hasDiagram: node['hasDiagram'] ?? false,
    hasEHLD: node['hasEHLD'] ?? false,
    diagramWidth: node['diagramWidth'] ?? 0,
    diagramHeight: node['diagramHeight'] ?? 0,
    ...only(node, ['category', 'isCanonical', 'definition']),
    inferred: node['isInferred'] ?? false,
    inDisease: node['isInDisease'] ?? false,
  };
}

/**
 * java.net.URLDecoder.decode(s, "UTF-8"), which content-service applies to
 * /pathways/top's species on top of the servlet's own decoding: '+' is a
 * space, runs of %XX are bytes decoded as UTF-8 (javaUtf8), and a '%' with
 * fewer than two characters after it, or two that Integer.parseInt(…, 16)
 * refuses, throws Java's own message -- which Java answers as a 500.
 * parseInt takes a sign, so '%-1' is the "negative value" error and '%+F' is
 * 0x0F, as in Java; its digits are Character.digit's.
 */
export function javaUrlDecode(text: string) {
  let out = '';
  let i = 0;
  while (i < text.length) {
    const c = text[i];
    if (c === '+') {
      out += ' ';
      i += 1;
    } else if (c === '%') {
      const bytes: number[] = [];
      while (i + 2 < text.length && text[i] === '%') {
        bytes.push(javaHexByte(text.slice(i + 1, i + 3)));
        i += 3;
      }
      if (i < text.length && text[i] === '%') {
        throw new Error('URLDecoder: Incomplete trailing escape (%) pattern');
      }
      out += javaUtf8(Uint8Array.from(bytes));
    } else {
      out += c;
      i += 1;
    }
  }
  return out;
}

/** Integer.parseInt(two, 16) as URLDecoder uses it, with its messages. */
function javaHexByte(two: string) {
  const digit = (ch: string) => {
    if (/^[0-9a-fA-F]$/.test(ch)) return parseInt(ch, 16);
    const code = ch.charCodeAt(0);
    // Fullwidth A-F and a-f, which Character.digit accepts.
    if (code >= 0xff21 && code <= 0xff26) return code - 0xff21 + 10;
    if (code >= 0xff41 && code <= 0xff46) return code - 0xff41 + 10;
    if (javaNumeric(ch)) return Number(asciiDigits(ch));
    return -1;
  };
  const refuse = (index: number) =>
    new Error(
      `URLDecoder: Illegal hex characters in escape (%) pattern - Error at index ${index} in: "${two}"`
    );
  let sign = 1;
  let start = 0;
  if (two[0] === '-' || two[0] === '+') {
    sign = two[0] === '-' ? -1 : 1;
    start = 1;
  }
  let value = 0;
  for (let k = start; k < two.length; k += 1) {
    // k is below the length.
    const d = digit(two[k] as string);
    if (d < 0) throw refuse(k);
    value = value * 16 + d;
  }
  value *= sign;
  if (value < 0) {
    throw new Error('URLDecoder: Illegal hex characters in escape (%) pattern - negative value');
  }
  return value;
}

/**
 * The species of /pathways/top/{species}, as graph-core's
 * TopLevelPathwayService reads it: StringUtils.isNumeric is a taxId, anything
 * else must equal a Species' displayName exactly -- "Homo sapiens" answers,
 * "homo sapiens" and "Homo_sapiens" are 404s. Not the looser speciesFilter
 * other endpoints use.
 */
export function topSpeciesMatch(raw: string) {
  return javaNumeric(raw)
    ? { where: 's.taxId = $species', params: { species: raw } }
    : { where: 's.displayName = $species', params: { species: raw } };
}

/**
 * A top-level pathway as Java writes it under /pathways/top/{species}: the
 * Pathway fields in Jackson's order -- releaseStatus before speciesName, then
 * the species, then doi -- with `species` the one-element array the caller
 * builds (the Species object the first time, its dbId after).
 */
export function topPathwayJson(pathway: Props, species: unknown) {
  return {
    ...only(pathway, [
      'dbId',
      'displayName',
      'stId',
      'stIdVersion',
      'isInDisease',
      'isInferred',
      'maxDepth',
      'name',
      'releaseDate',
      'releaseStatus',
      'speciesName',
    ]),
    species: [species],
    ...only(pathway, ['doi', 'hasDiagram', 'hasEHLD', 'lastUpdatedDate']),
    schemaClass: pathway['schemaClass'],
    className: pathway['schemaClass'],
  };
}

/**
 * What a NullPointerException would have been in Java: graph-core dereferences
 * a few values without checking them, and Java answers its generic 500 then.
 */
class JavaNullPointer extends Error {}

/** Java's String.compareTo: by UTF-16 unit, which is also what `<` compares. */
function javaCompare(a: string | null | undefined, b: string | null | undefined) {
  if (a === null || a === undefined) throw new JavaNullPointer('compareTo on null');
  if (b === null || b === undefined) throw new JavaNullPointer('compareTo with null');
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * graph-core's PathwayBrowserNode (service/helper), the node of every tree the
 * Pathway Browser's hierarchy endpoints answer with.
 *
 * Its children and parents are TreeSets ordered by compareTo -- species, then
 * the curated `order`, then name -- and a TreeSet keeps the first of two
 * entries that compare equal, so two different events with the same name,
 * species and order under one parent are one child. Kept, because Java's
 * answer is that: here they are arrays held in that order, with that rule.
 *
 * There is no equals or hashCode, and no identity in the JSON: a node reached
 * from two parents is one object, written out in full under each.
 */
export class PathwayBrowserNode {
  // Initialised, not declared: Jackson's order is these fields' (pathwayBrowserJson).
  // type and unique may be null too, as Java's may: treeFromLeaf checks them
  // as Java dereferences them.
  stId: string | undefined = undefined;
  name: string | undefined = undefined;
  species: string | undefined = undefined;
  url: string | undefined = undefined;
  type: string | null | undefined = undefined;
  diagram: boolean | undefined = undefined;
  unique: boolean | null | undefined = undefined;
  order: number | undefined = undefined;
  children: PathwayBrowserNode[] | null = null;
  parent: PathwayBrowserNode[] | null = null;

  addChild(node: PathwayBrowserNode) {
    this.children = sortedAdd(this.children, node);
  }

  addParent(node: PathwayBrowserNode) {
    this.parent = sortedAdd(this.parent, node);
  }

  hasDiagram() {
    return this.diagram ?? false;
  }

  /** PathwayBrowserNode.compareTo. */
  compareTo(node: PathwayBrowserNode) {
    const species = javaCompare(this.species ?? '', node.species ?? '');
    if (species !== 0) return species;
    const order = (this.order ?? 0) - (node.order ?? 0);
    if (order !== 0) return order;
    return javaCompare(this.name, node.name);
  }

  /** getLeaves: a TreeSet, so leaves that compare equal are one. */
  getLeaves(): PathwayBrowserNode[] {
    if (this.children === null) return [this];
    let leaves: PathwayBrowserNode[] | null = null;
    for (const child of this.children) {
      for (const leaf of child.getLeaves()) leaves = sortedAdd(leaves, leaf);
    }
    return leaves ?? [];
  }
}

/** TreeSet.add: in compareTo order, and nothing added when an equal one is there. */
function sortedAdd(set: PathwayBrowserNode[] | null, node: PathwayBrowserNode) {
  const list = set ?? [];
  // TreeMap.put on an empty map still compares the key with itself.
  if (list.length === 0) node.compareTo(node);
  let low = 0;
  let high = list.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    // middle is below the length.
    const order = node.compareTo(list[middle] as PathwayBrowserNode);
    if (order === 0) return list;
    if (order < 0) high = middle;
    else low = middle + 1;
  }
  list.splice(low, 0, node);
  return list;
}

/**
 * HierarchyTreeItem.build: one `[stId, displayName, hasDiagram, speciesName,
 * schemaClass, labels, order]` row of the query, read with the driver's
 * defaults -- a missing flag is false and a missing order 0.
 */
function treeItem(row: LocationStep) {
  return {
    stId: row[0] ?? null,
    displayName: row[1] ?? null,
    hasDiagram: row[2] ?? false,
    speciesName: row[3] ?? null,
    schemaClass: row[4] ?? null,
    labels: row[5] ?? [],
    order: row[6] ?? 0,
  };
}

/** The types the browser cannot place, which the tree skips unless told not to. */
function displayable(type: string | null | undefined) {
  if (type === null || type === undefined) throw new JavaNullPointer('type');
  return (
    type !== 'CatalystActivity' &&
    !type.includes('Regulation') &&
    type !== 'Requirement' &&
    type !== 'EntityFunctionalStatus'
  );
}

/**
 * HierarchyRepository.parseRaw, kept line for line: the tree from the query's
 * root and its paths, each path a list of tree items.
 *
 * One node per stId (a HashMap, so every item without a stable id is the one
 * node too). A path longer than the previous one is taken to extend it, and
 * only its last step is added, to whatever node the previous path ended on --
 * true of the order Neo4j expands paths in, and not checked. Anything else
 * starts again from the root. That rule is why the query is run exactly as
 * Java writes it: the rows' order is part of the answer.
 */
export function parseHierarchy(
  rootRow: LocationStep,
  paths: LocationStep[][] | null,
  omitNonDisplayableItems: boolean
) {
  const rootItem = treeItem(rootRow);
  const root = new PathwayBrowserNode();
  root.stId = rootItem.stId ?? undefined;
  root.name = rootItem.displayName ?? undefined;
  root.type = rootItem.schemaClass ?? undefined;
  if (rootItem.labels.includes('Event')) {
    root.species = rootItem.speciesName ?? undefined;
    if (rootItem.labels.includes('Pathway')) root.diagram = rootItem.hasDiagram;
  } else if (rootItem.labels.includes('PhysicalEntity')) {
    root.species = rootItem.speciesName ?? undefined;
  }

  const nodes = new Map([[rootItem.stId, root]]);
  const addNode = (previous: PathwayBrowserNode, row: LocationStep) => {
    const found = treeItem(row);
    let node = nodes.get(found.stId);
    if (!node) {
      node = new PathwayBrowserNode();
      node.stId = found.stId ?? undefined;
      node.name = found.displayName ?? undefined;
      node.diagram = found.hasDiagram;
      node.species = found.speciesName ?? undefined;
      node.type = found.schemaClass ?? undefined;
      node.order = found.order;
      nodes.set(found.stId, node);
    }
    if (!omitNonDisplayableItems || displayable(node.type)) {
      previous.addChild(node);
      node.addParent(previous);
      return node;
    }
    return previous;
  };

  let previous = root;
  let previousSize = 0;
  for (const path of paths ?? []) {
    if (path.length > previousSize) {
      // Longer than the last, so not empty.
      previous = addNode(previous, path[path.length - 1] as LocationStep);
    } else {
      previous = root;
      for (const row of path) previous = addNode(previous, row);
    }
    previousSize = path.length;
  }
  return root;
}

const PATHWAY_BROWSER_URL = '/PathwayBrowser/#/';

const PATHWAY_TYPES = new Set(['Pathway', 'CellLineagePath', 'TopLevelPathway']);

/**
 * The controller's getLeaves, PathwayBrowserLocationsUtils.removeOrphans and
 * buildTreesFromLeaves: the reverse graph turned round, one tree per top-level
 * pathway, each node carrying the browser address that opens it in place.
 * Kept line for line, `unique` included: it is written onto the shared graph
 * nodes as the walk goes, so a node's address depends on the walk's order.
 */
export function locationsInPathwayBrowser(root: PathwayBrowserNode) {
  const leaves = root.getLeaves().filter((leaf) => leaf.type === 'TopLevelPathway');
  let trees: PathwayBrowserNode[] | null = null;
  for (const leaf of leaves) trees = sortedAdd(trees, treeFromLeaf(leaf, '', '', '', ''));
  return trees ?? [];
}

function treeFromLeaf(
  leaf: PathwayBrowserNode,
  sel: string | null | undefined,
  path: string,
  shortPath: string,
  lastNodeWithDiagram: string | undefined
): PathwayBrowserNode {
  const tree = new PathwayBrowserNode();
  tree.stId = leaf.stId;
  tree.name = leaf.name;
  tree.species = leaf.species;
  tree.type = leaf.type;

  if (leaf.type === null || leaf.type === undefined) throw new JavaNullPointer('type');
  const isPathway = PATHWAY_TYPES.has(leaf.type);
  const hasDiagram = leaf.hasDiagram();
  leaf.unique = false;

  let main: string | undefined;
  if (isPathway) {
    main = leaf.stId;
  } else {
    sel = leaf.stId;
    main = lastNodeWithDiagram;
  }

  const children = leaf.children;
  if (isPathway) {
    if (children === null) {
      leaf.unique = true;
    } else if (children.length === 1) {
      // One child: the length was checked.
      const only = (children[0] as PathwayBrowserNode).unique;
      if (only === null || only === undefined) throw new JavaNullPointer('isUnique');
      if (only) leaf.unique = true;
    }
  }

  // StringBuilder.append(null) writes "null".
  const text = (value: string | null | undefined) =>
    value === null || value === undefined ? 'null' : String(value);
  let url = PATHWAY_BROWSER_URL;
  if (leaf.unique) {
    url += text(leaf.stId);
  } else {
    url += text(main);
    if (sel === null || sel === undefined) throw new JavaNullPointer('sel');
    if (sel !== '') url += `&amp;SEL=${sel}`;
    const trail = isPathway ? path : shortPath;
    if (trail !== '') url += `&amp;PATH=${trail}`;
  }
  tree.url = url;

  if (isPathway) {
    if (hasDiagram) {
      shortPath += shortPath === '' ? text(lastNodeWithDiagram) : `,${text(lastNodeWithDiagram)}`;
    } else {
      path += path === '' ? text(leaf.stId) : `,${text(leaf.stId)}`;
    }
  }
  if (hasDiagram) lastNodeWithDiagram = leaf.stId;

  for (const node of leaf.parent ?? []) {
    tree.addChild(treeFromLeaf(node, sel, path, shortPath, lastNodeWithDiagram));
  }
  return tree;
}

/**
 * A PathwayBrowserNode as Jackson writes it: the field-backed properties in
 * declaration order, the @JsonIgnore'd ones (unique, order, parent and two
 * flags) never, and -- under the service's non_empty -- nothing that is null,
 * and no empty children.
 */
export function pathwayBrowserJson(node: PathwayBrowserNode): LocationNode {
  // As the site reads it (spec 013 T019), in Jackson's order. `diagram` is
  // never set on a node of these trees, so Java never writes it either.
  // stId and name are in every measured answer, and the site's type requires
  // them; a node without one is written without it, as Java writes it, never
  // turned into a failure -- in that case, never seen, the type overstates.
  const out: JsonWritten<LocationNode> = {
    stId: node.stId as string,
    name: node.name as string,
    species: node.species ?? undefined,
    url: node.url as string,
    type: node.type as string,
    children: node.children?.length ? node.children.map(pathwayBrowserJson) : undefined,
  };
  // JSON's step: an undefined field is written as absent.
  return out as LocationNode;
}

/**
 * What graph-core's getContainedEvents throws on before it asks anything:
 * an id of dots, which trimId splits to nothing (Java's 500 with no
 * message), and a dbId past a long (Long.parseLong's). Undefined otherwise.
 */
function containedEventsFailure(request: Request, raw: string) {
  const trimmed = javaTrim(raw);
  if (/^\.+$/.test(trimmed)) return javaError(request, 500, 'INTERNAL_SERVER_ERROR', null);
  const tooLong = longPastRange([raw]);
  return tooLong ? javaError(request, 500, 'INTERNAL_SERVER_ERROR', tooLong) : undefined;
}

/**
 * PathwaysService.getContainedEvents: the id read as graph-core reads it
 * (graphCoreId), then EventRepository.getContainedEventsByStId / ByDbId --
 * Neo4jTemplate.findAll over its query, as written: one event per record,
 * with the hasEvent relationships of its paths and the pathway asked about,
 * mapped as SDN maps many records (mapResults). [] for none.
 */
async function containedEvents(raw: string) {
  const id = await graphCoreId(raw);
  if (!id) return [];
  const rows = await read<{
    e: GraphNode;
    'COLLECT(r)': GraphRelationship[][];
    'COLLECT(p)': GraphNode[];
  }>(
    id.byDbId
      ? 'MATCH (p:Pathway)-[r:hasEvent*1..100]->(e:Event) WHERE p.dbId = $dbId RETURN e, COLLECT(r), COLLECT(p)'
      : 'MATCH (p:Pathway)-[r:hasEvent*1..100]->(e:Event) WHERE p.stId = $stId RETURN e, COLLECT(r), COLLECT(p)',
    id.byDbId ? { dbId: neo4j.int(id.params.id) } : { stId: id.params.id },
    { graph: true }
  );
  return mapResults(
    rows.map((row) => ({
      root: row.e,
      // extractNodes: the list column's nodes, then the single node.
      nodes: row['COLLECT(p)'],
      // extractRelationships: every list's relationships, flattened.
      relationships: row['COLLECT(r)'].flat(),
    }))
  );
}

/** Every relationship from an event down to its participants, as graph-core lists them. */
const PARTICIPANT_OF =
  'regulatedBy|regulator|catalystActivity|physicalEntity|entityFunctionalStatus|diseaseEntity|hasMember|hasCandidate|hasComponent|repeatedUnit|input|output|proteinMarker|RNAMarker*';

/** From an entity down to the reference entities of its every form. */
const FORMS_OF =
  'regulator|hasComponent|repeatedUnit|hasMember|hasCandidate|referenceEntity|proteinMarker|RNAMarker*';

/*
 * graph-core's PathwayRepository queries for the /pathways/low family, kept as
 * written: the order of the rows is the order these queries produce, and
 * HEAD(COLLECT(p)) -- each reaction's first diagram -- is whichever pathway the
 * plan meets first. Each takes the object's pattern ({stId: $id} or
 * {dbId: toInteger($id)}) and a species pattern for each place graph-core puts
 * one; empty without a species. graph-core writes the species three ways, the
 * first diagram arm's without a label -- `(Species{...})` binds a variable
 * named Species -- and they are kept, not tidied, since tidying a query is
 * what reordered rows before.
 */
/** A /pathways/low query: the column its rows carry, and its text for an object and a species. */
interface LowQuery {
  column: string;
  query: (object: string, species: (pattern: string) => string) => string;
}

const PATHWAYS_FOR: LowQuery = {
  column: 'p',
  query: (object, species) => {
    const sp = species('(:Species{taxId:$taxId})');
    return `MATCH (:DatabaseObject${object})<-[:${PARTICIPANT_OF}]-()<-[:hasEvent]-(p:Pathway)${sp}
         RETURN DISTINCT p
         UNION
         MATCH (:ReactionLikeEvent${object})<-[:hasEvent]-(p:Pathway)${sp}
         RETURN DISTINCT p
         UNION
         MATCH (p:Pathway${object})${sp}
         RETURN DISTINCT p`;
  },
};

const PATHWAYS_FOR_ALL_FORMS: LowQuery = {
  column: 'p',
  query: (object, species) =>
    `MATCH (:DatabaseObject${object})-[:${FORMS_OF}]->(re:ReferenceEntity)
     WITH re
     MATCH (re)<-[:referenceEntity]-(:PhysicalEntity)<-[:${PARTICIPANT_OF}]-(:ReactionLikeEvent)<-[:hasEvent]-(p:Pathway)${species('(:Species{taxId:$taxId})')}
     RETURN DISTINCT p`,
};

const PATHWAYS_WITH_DIAGRAM_FOR: LowQuery = {
  column: 'm',
  query: (object, species) =>
    `MATCH (:PhysicalEntity${object})<-[:${PARTICIPANT_OF}]-(r:ReactionLikeEvent)<-[:hasEvent*]-(p:Pathway{hasDiagram:True})${species('(Species{taxId:$taxId})')}
     WITH r, HEAD(COLLECT(p)) AS m
     RETURN DISTINCT m
     UNION
     MATCH (r:ReactionLikeEvent${object})<-[:hasEvent]-(p:Pathway{hasDiagram:True})${species('(s:Species{taxId:$taxId})')}
     WITH r, HEAD(COLLECT(p)) AS m
     RETURN DISTINCT m
     UNION
     MATCH (o:Pathway${object})-[:hasEvent*]->(p:Pathway{hasDiagram:True})${species('(s:Species{taxId:$taxId})')}
     WITH o, HEAD(COLLECT(p)) AS m
     RETURN DISTINCT m`,
};

const PATHWAYS_WITH_DIAGRAM_FOR_ALL_FORMS: LowQuery = {
  column: 'm',
  query: (object, species) =>
    `MATCH (:PhysicalEntity${object})-[:${FORMS_OF}]->(re:ReferenceEntity)
     WITH re
     MATCH (re)<-[:referenceEntity]-(:PhysicalEntity)<-[:${PARTICIPANT_OF}]-(r:ReactionLikeEvent)<-[:hasEvent*]-(p:Pathway{hasDiagram:True})${species('(Species{taxId:$taxId})')}
     WITH r, HEAD(COLLECT(p)) AS m
     RETURN DISTINCT m`,
};

/** From an outside identifier (a reference entity, sequence, gene or cross reference) to its entities. */
const NAMED_BY = 'referenceEntity|referenceSequence|crossReference|referenceGene*';

/** An outside identifier as graph-core matches it: its identifier, or one of its names or gene names. */
const IDENTIFIER_IS =
  'n.identifier = $identifier OR $identifier IN n.name OR $identifier IN n.geneName';

/**
 * graph-core's PathwayRepository.getLowerLevelPathwaysForIdentifier and
 * ...AndSpeciesTaxId. Without a species, as written: its second arm asks
 * for `$stId`, which graph-core never binds, so Neo4j refuses the query
 * (ParameterMissing) whatever the identifier, and Java answers that as its
 * 500.
 *
 * In a species, graph-core's query finds its entities by scanning every
 * node (AllNodesScan) for a physical entity and walking down from each to
 * the identifier: 22-27s alone, past this service's 30s read limit as soon
 * as the database is busy. Here the walk starts from the other end. The
 * nodes the identifier names are found first -- reference entities by
 * identifier, name or gene name, database identifiers by identifier, the
 * only two kinds of node the walk can end at and the only ones of those
 * with names (measured: no database identifier has a name or a gene name)
 * -- and the entities above them are then put in the order the scan met
 * them, by node id, before the walk up to the pathways, unchanged. So the
 * rows come in Java's order: measured against graph-core's query, row for
 * row, over 62 identifiers (spec 006 T106), in 3-8s.
 */
function identifierAllFormsQuery(inSpecies: boolean) {
  const species = inSpecies ? '-[:species]->(s:Species{taxId:$taxId})' : '';
  const entity = inSpecies ? '$identifier' : '$stId';
  const named = inSpecies
    ? 'CALL { MATCH (n:ReferenceEntity) WHERE ' +
      `${IDENTIFIER_IS} RETURN n UNION MATCH (n:DatabaseIdentifier) WHERE n.identifier = $identifier RETURN n } ` +
      `MATCH (rd:ReferenceDatabase)<--(n)<-[:${NAMED_BY}]-(pe:PhysicalEntity) WITH DISTINCT pe ORDER BY id(pe) `
    : `MATCH (rd:ReferenceDatabase)<--(n)<-[:${NAMED_BY}]-(pe:PhysicalEntity) WHERE ${IDENTIFIER_IS} WITH DISTINCT pe `;
  return (
    `${named}MATCH (pe)<-[:${PARTICIPANT_OF}]-(:ReactionLikeEvent)<-[:hasEvent]-(p:Pathway)${species} RETURN DISTINCT p ` +
    `UNION MATCH (pe:PhysicalEntity{stId:${entity}})<-[:${PARTICIPANT_OF}]-(:ReactionLikeEvent)<-[:hasEvent]-(p:Pathway)${species} RETURN DISTINCT p`
  );
}

/**
 * graph-core's TopLevelPathwayRepository.getCuratedTopLevelPathwaysByTaxId
 * and ...ByName, as written: the top-level pathways that are not inferred,
 * with their species. TopLevelPathwayService chooses by
 * StringUtils.isNumeric, as /pathways/top/{species} does (topSpeciesMatch),
 * but the name is not decoded a second time.
 */
function curatedTopQuery(byTaxId: boolean) {
  return byTaxId
    ? 'MATCH (n:TopLevelPathway{isInferred:False})-[r:species]-(s:Species{taxId:$taxId}) RETURN n, collect(r), collect(s)  ORDER BY toLower(n.displayName)'
    : 'MATCH (n:TopLevelPathway{isInferred:False})-[r:species]-(s:Species{displayName:$speciesName}) RETURN n, collect(r), collect(s) ORDER BY toLower(n.displayName)';
}

/** The entities a diagram's reactions take part through, from the reaction down. */
const DIAGRAM_PARTICIPANT =
  'input|output|catalystActivity|physicalEntity|entityFunctionalStatus|diseaseEntity|regulatedBy|regulator*';

/**
 * graph-core's SimpleDatabaseObjectRepository.getDiagramEntitiesForIdentifierByStId
 * and ...ByDbId, as written: the diagram's pathway and every pathway below
 * it without a diagram of its own, their reactions, and the entities in them
 * that an outside identifier names -- or, by the second arm, that are or
 * contain the entity whose stable id it is.
 */
function diagramEntitiesQuery(byDbId: boolean) {
  const pathway = byDbId ? '(t:Pathway{dbId:$dbId})' : '(t:Pathway{stId:$stId})';
  const reactions =
    `MATCH ${pathway} OPTIONAL MATCH path=(t)-[:hasEvent*]->(p:Pathway{hasDiagram:False}) WHERE ALL(n IN TAIL(NODES(path)) WHERE n.hasDiagram = False) ` +
    'WITH CASE WHEN path IS NULL THEN t ELSE NODES(path) END AS ps UNWIND ps AS p MATCH (p)-[:hasEvent]->(rle:ReactionLikeEvent) WITH DISTINCT rle ';
  const written =
    'RETURN DISTINCT pe.dbId AS dbId, pe.stId AS stId, pe.displayName AS displayName, labels(pe) AS labels';
  return (
    ` ${reactions}MATCH (rd:ReferenceDatabase)<--(n)<-[:referenceEntity|referenceSequence|crossReference|referenceGene|hasComponent|hasMember|hasCandidate|repeatedUnit|proteinMarker|RNAMarker*]-(pe)<-[:${DIAGRAM_PARTICIPANT}]-(rle) WHERE ${IDENTIFIER_IS} ${written} ` +
    `UNION ${reactions}MATCH (rle)-[:${DIAGRAM_PARTICIPANT}]->(pe:PhysicalEntity) WITH DISTINCT pe OPTIONAL MATCH (pe)-[:hasComponent|hasMember|hasCandidate|repeatedUnit|proteinMarker|RNAMarker*]->(a:PhysicalEntity) WITH DISTINCT pe, COLLECT(DISTINCT a.stId) AS participants WHERE pe.stId = $identifier OR $identifier IN participants ${written}`
  );
}

/**
 * graph-core's SimpleDatabaseObjectRepository.getPathwaysForIdentifierByStId
 * and ...ByDbId, as written -- the dbId query's list is also `$stIds`: the
 * pathways among those given that reach an entity the identifier names, or
 * the entity whose stable id it is.
 */
function pathwaysForIdentifierQuery(byDbId: boolean) {
  const among = byDbId ? 'p.dbId IN $stIds' : 'p.stId IN $stIds';
  const written =
    'RETURN DISTINCT p.dbId AS dbId, p.stId AS stId, p.displayName AS displayName, labels(p) AS labels';
  const down =
    'regulatedBy|regulator|catalystActivity|physicalEntity|entityFunctionalStatus|diseaseEntity|hasMember|hasCandidate|hasComponent|repeatedUnit|input|output|hasEvent|proteinMarker|RNAMarker*';
  return (
    ` MATCH (p:Pathway)-[:${down}]->(pe:PhysicalEntity) WHERE ${among} WITH DISTINCT p, pe ` +
    `MATCH (pe)-[:referenceEntity|referenceSequence|crossReference|referenceGene*]->(n)-->(rd:ReferenceDatabase) WHERE ${IDENTIFIER_IS} ${written} ` +
    `UNION MATCH (p:Pathway)-[:${down}]->(pe:PhysicalEntity{stId:$identifier}) WHERE ${among} ${written}`
  );
}

/** One row of the diagram entity queries: a SimpleDatabaseObject before it is built. */
type SimpleRow = {
  dbId: number;
  stId: string | null;
  displayName: string | null;
  labels: string[];
};

/**
 * SimpleDatabaseObject.build(Record): stId as given (null left out),
 * displayName as asString writes a null ("null"), schemaClass from the labels
 * (DatabaseObjectUtils.getSchemaClass). Written by Jackson with non_empty.
 */
function simpleObject(row: SimpleRow): SimpleDatabaseObject {
  const out: JsonWritten<SimpleDatabaseObject> = {
    dbId: row.dbId,
    stId: row.stId !== null && row.stId !== '' ? row.stId : undefined,
    displayName: row.displayName === '' ? undefined : (row.displayName ?? 'null'),
    schemaClass: schemaClassOf(row.labels),
  };
  // javaJson leaves the undefined ones out, as non_empty does.
  return out as SimpleDatabaseObject;
}

/** Long.hashCode: the high half folded into the low. */
function longHash(id: number) {
  const big = BigInt.asUintN(64, BigInt(id));
  return Number(BigInt.asIntN(32, big ^ (big >> 32n)));
}

/** A HashSet<SimpleDatabaseObject>, whose equals and hashCode are the dbId's. */
function simpleObjectSet() {
  return new JavaHashMap<number, SimpleDatabaseObject>({ hash: longHash });
}

/** HashSet.add: a dbId already there keeps the object it has. */
function addTo(set: JavaHashMap<number, SimpleDatabaseObject>, object: SimpleDatabaseObject) {
  if (!set.has(object.dbId)) set.set(object.dbId, object);
}

/**
 * The `pathways` of /diagram/{id}/entities/{identifier}, a Collection<String>
 * as Spring binds it: a LinkedHashSet of springList's values, so repeats
 * fall and the order stays. Past twenty the controller keeps the first
 * twenty in a HashSet (Collectors.toSet), whose order is then the strings'
 * hash order -- the order the 404 message lists them in.
 */
function diagramPathways(values: string[]): string[] | null {
  const list = springList(values);
  if (list === null) return null;
  const given = [...new Set(list)];
  if (given.length <= 20) return given;
  const set = new JavaHashMap<string, boolean>();
  for (const pathway of given.slice(0, 20)) set.set(pathway, true);
  return [...set.keys()];
}

/**
 * PathwaysService.getDiagramEntitiesForIdentifier: the pathway's id read
 * by getIdentifier, but the query given the id as it came -- so a version
 * or an old id finds nothing, and a dbId must be Long.parseLong's own: one
 * padded, versioned or past a long is its NumberFormatException, naming
 * the id as given. {failure} for Java's 500, else the rows.
 */
async function diagramEntities(
  pathwayId: string,
  identifier: string
): Promise<{ failure: string } | { rows: SimpleRow[] }> {
  // trimId splits an id of dots to nothing: an ArrayIndexOutOfBounds.
  if (/^\.+$/.test(javaTrim(pathwayId))) return { failure: 'Index 0 out of bounds for length 0' };
  const id = inDepthId(pathwayId);
  if (id === undefined) return { rows: [] };
  if (id.idType !== 'dbId')
    return {
      rows: await read<SimpleRow>(diagramEntitiesQuery(false), { stId: pathwayId, identifier }),
    };
  const digits = javaNumeric(pathwayId) ? asciiDigits(pathwayId) : undefined;
  if (digits === undefined || BigInt(digits) > 9223372036854775807n)
    return { failure: `For input string: "${pathwayId}"` };
  return {
    rows: await read<SimpleRow>(diagramEntitiesQuery(true), {
      dbId: neo4j.int(digits),
      identifier,
    }),
  };
}

/**
 * PathwaysService.getPathwaysForIdentifier(identifier, pathways): each id
 * read by getIdentifier (an old id swapped for its stable id), stable ids
 * and dbIds asked for apart, the answers gathered in a HashSet -- whose
 * order the controller's set then meets them in. What getIdentifier and
 * Long.valueOf throw, for the first id in order, is {failure}.
 */
async function pathwaysForIdentifier(
  identifier: string,
  pathways: string[]
): Promise<{ failure: string } | { found: SimpleDatabaseObject[] }> {
  const failure = findByIdFailure(pathways);
  if (failure) return { failure };
  // Two HashSets, handed to the queries in their order -- which is the
  // order an IN list is sought in, and so the order the rows come back in.
  const stIds = new JavaHashMap<string, boolean>();
  const dbIds = new JavaHashMap<number, string>({ hash: longHash });
  for (const pathway of pathways) {
    const id = await graphCoreId(pathway);
    if (!id) continue;
    if (id.byDbId) dbIds.set(Number(id.params.id), id.params.id);
    else stIds.set(id.params.id, true);
  }
  const found = simpleObjectSet();
  if (stIds.size)
    for (const row of await read<SimpleRow>(pathwaysForIdentifierQuery(false), {
      identifier,
      stIds: [...stIds.keys()],
    }))
      addTo(found, simpleObject(row));
  if (dbIds.size)
    for (const row of await read<SimpleRow>(pathwaysForIdentifierQuery(true), {
      identifier,
      stIds: [...dbIds.values()].map((digits) => neo4j.int(digits)),
    }))
      addTo(found, simpleObject(row));
  return { found: [...found.values()] };
}

/**
 * One of the /pathways/low family, optionally in one species: PathwaysService
 * dispatches each the same way, to one of the queries above.
 *
 * The id is the path's `segment`th, read as graph-core reads it (graphCoreId).
 *
 * `species` is read as graph-core's SpeciesService reads it (speciesFilter).
 * A species that is not found filters nothing, as in Java; the 404 message
 * repeats the parameter as given, and says "null" when there is none.
 */
async function lowerLevelPathways(request: Request, segment: number, { column, query }: LowQuery) {
  const raw = pathId(rawSegment(request, segment));
  // By the servlet's rules (queryValues), not Express's query parser, which
  // reads brackets in a name as structure; repeated, Spring joins them.
  const given = queryValues(request, 'species');
  const species = given.length ? given.join(',') : undefined;
  const missing = () =>
    notFound(request, `No result for ${raw} in ${species === undefined ? 'null' : species}`);

  const id = await graphCoreId(raw);
  if (!id) return missing();
  const { object, params } = id;

  const taxId = await speciesTaxId(speciesFilter(species));
  const inSpecies = (pattern: string) => (taxId === undefined ? '' : `-[:species]->${pattern}`);
  const rows = await read<{ [column: string]: Props }>(query(object, inSpecies), {
    ...params,
    ...(taxId === undefined ? {} : { taxId }),
  });
  if (rows.length === 0) return missing();
  return {
    status: 200,
    // query returns `column`, so every row has it.
    body: rows.map((row) => pathwayJson(row[column] as Props)),
    type: 'application/json',
  };
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

/** A Species as graph-core's SpeciesService finds one for the events hierarchy. */
type HierarchySpecies = { dbId: number; taxId: string | null; displayName: string };

const SPECIES_FIELDS = 's.dbId AS dbId, s.taxId AS taxId, s.displayName AS displayName';

/**
 * SpeciesService.getSpecies(String), as EventsController's pathwaysOnly
 * branch calls it: empty is none; all digits (StringUtils.isNumeric) is a
 * taxId, and failing that a dbId by Long.valueOf, whose overflow is Java's
 * NumberFormatException; anything else lower-cased, each run of `_` and
 * space made one space, capitalised, and matched against every name a
 * Species has (getSpeciesByName). Each repository asks for one Species: two
 * would be Spring Data's failure, never seen (no two share a taxId or a name).
 */
async function hierarchySpecies(
  raw: string
): Promise<{ species?: HierarchySpecies; failure?: string; ambiguous?: boolean }> {
  if (raw === '') return {};
  const one = (rows: HierarchySpecies[]) =>
    rows.length > 1 ? { ambiguous: true } : rows[0] ? { species: rows[0] } : {};
  if (!javaNumeric(raw)) {
    const lower = raw.toLowerCase().replace(/[_ ]+/g, ' ');
    const name = javaCapitalize(lower);
    return one(
      await read<HierarchySpecies>(
        `MATCH (s:Species) WHERE $name IN s.name RETURN ${SPECIES_FIELDS} LIMIT 2`,
        { name }
      )
    );
  }
  const byTaxId = await read<HierarchySpecies>(
    `MATCH (s:Species {taxId: $taxId}) RETURN ${SPECIES_FIELDS} LIMIT 2`,
    { taxId: raw }
  );
  if (byTaxId.length) return one(byTaxId);
  const digits = asciiDigits(raw);
  if (BigInt(digits) > 9223372036854775807n) return { failure: `For input string: "${raw}"` };
  return one(
    await read<HierarchySpecies>(
      `MATCH (s:Species {dbId: $dbId}) RETURN ${SPECIES_FIELDS} LIMIT 2`,
      { dbId: neo4j.int(digits) }
    )
  );
}

/** Character.toTitleCase where it is not toUpperCase: the four digraph letters. */
const TITLE_CASE: Record<string, string> = {
  Ǆ: 'ǅ',
  ǅ: 'ǅ',
  ǆ: 'ǅ',
  Ǉ: 'ǈ',
  ǈ: 'ǈ',
  ǉ: 'ǈ',
  Ǌ: 'ǋ',
  ǋ: 'ǋ',
  ǌ: 'ǋ',
  Ǳ: 'ǲ',
  ǲ: 'ǲ',
  ǳ: 'ǲ',
};

/**
 * StringUtils.capitalize (commons-lang3 3.12): the first code point in title
 * case, the rest as they are. Title case is upper case but for the digraphs
 * above, and a letter whose upper case is more than one letter (ß, ŉ) is
 * left as it is, as Character.toTitleCase leaves it. (The Greek letters with
 * iota subscript, which Java title-cases to one letter, stay as they are here:
 * no species name could match either.)
 */
function javaCapitalize(text: string) {
  const first = String.fromCodePoint(text.codePointAt(0) ?? 0);
  if (text === '') return text;
  const upper = first.toUpperCase();
  const title = TITLE_CASE[first] ?? ([...upper].length === 1 ? upper : first);
  return title + text.slice(first.length);
}

/** One pathway of the AnalysisService's hierarchy, as HierarchyBuilder reads it. */
type HierarchyPathway = {
  stId: string;
  name: string | null;
  type: string | null;
  diagram: boolean | null;
};

/**
 * HierarchyBuilder's tree for a species: its top-level pathways
 * (TopLevelPathwayService, by toLower(displayName)), each given its place
 * among them as its order, then every Pathway each holds through hasEvent,
 * with the relationship's order, whatever its species.
 */
async function hierarchyRows(taxId: string) {
  const [tops, events] = await Promise.all([
    // TopLevelPathwayRepository's query, in its shape: two top-level pathways
    // of one name (Gallus gallus has two "Metabolism") come in the order
    // Neo4j gives, which a query of another shape need not match (D25).
    read<{ stId: string }>(
      `MATCH (n:TopLevelPathway)-[r:species]-(s:Species {taxId: $taxId})
       WITH n, collect(r) AS r, collect(s) AS s
       RETURN n.stId AS stId ORDER BY toLower(n.displayName) ASC`,
      { taxId }
    ),
    read<{ parent: string; child: string; order: number | null; pathway: boolean }>(
      `MATCH (t:TopLevelPathway)-[:species]->(s:Species) WHERE s.taxId = $taxId
       MATCH (t)-[:hasEvent*0..]->(p:Pathway)-[r:hasEvent]->(c:Event)
       RETURN DISTINCT p.stId AS parent, c.stId AS child, r.order AS order, c:Pathway AS pathway`,
      { taxId }
    ),
  ]);
  const edges = keptPathways(events);
  const stIds = [...new Set([...tops.map((t) => t.stId), ...edges.map((e) => e.child)])];
  const pathways = await read<HierarchyPathway>(
    `MATCH (p:Pathway) WHERE p.stId IN $stIds
     RETURN p.stId AS stId, p.displayName AS name, p.schemaClass AS type, p.hasDiagram AS diagram`,
    { stIds }
  );
  return { tops, edges, pathways };
}

/**
 * The subpathways HierarchyBuilder.fillBranch keeps. A pathway's events are a
 * SortedSet of hasEvent ordered by `order` alone (Has.compareTo), so of two
 * events with one order -- of any kind, a reaction too -- the set keeps one,
 * and only then are pathways picked out. Which one Java keeps is the order it
 * loaded them in; here, the first the graph returns. No pathway has two
 * events of one order in release 98, so none is dropped (D25).
 */
function keptPathways(
  events: { parent: string; child: string; order: number | null; pathway: boolean }[]
) {
  const taken = new Set<string>();
  const kept: { parent: string; child: string; order: number }[] = [];
  for (const { parent, child, order, pathway } of events) {
    // Has.order is an int: a missing one is 0.
    const at = `${parent} ${order ?? 0}`;
    if (taken.has(at)) continue;
    taken.add(at);
    if (pathway) kept.push({ parent, child, order: order ?? 0 });
  }
  return kept;
}

/** A node of the tree before it is written: what PathwayBrowserNode.compareTo reads. */
type Placed = { stId: string; name: string; order: number };

/**
 * PathwayBrowserNode.compareTo within one species, as the TreeSet of a
 * node's children uses it: order, then name by String.compareTo. Two that
 * compare equal are one, the first kept.
 */
function treeSetOf<T extends Placed>(nodes: T[]): T[] {
  const kept: T[] = [];
  // Array.sort is stable, so the first of two equal ones stays first.
  const sorted = [...nodes].sort((a, b) => a.order - b.order || javaCompare(a.name, b.name));
  for (const node of sorted) {
    const last = kept[kept.length - 1];
    if (last && last.order === node.order && last.name === node.name) continue;
    kept.push(node);
  }
  return kept;
}

/**
 * The pathwaysOnly answer for a species with a hierarchy, built once per
 * species while the process lives: SizedPathwayBrowserNode over each
 * PathwayNode -- stId, name, the species' name, type, whether it has a
 * diagram of its own, its sizes (analysisSizes), its children -- in
 * Jackson's order, with children left out where there are none. A pathway
 * under two parents is the same subtree under each.
 */
async function pathwaysOnlyTree(taxId: string, speciesName: string) {
  const [{ tops, edges, pathways }, sizes] = await Promise.all([
    hierarchyRows(taxId),
    analysisSizes(taxId),
  ]);
  const byStId = new Map(pathways.map((p) => [p.stId, p]));
  const childrenOf = new Map<string, { stId: string; order: number }[]>();
  for (const { parent, child, order } of edges) {
    const list = childrenOf.get(parent) ?? [];
    list.push({ stId: child, order });
    childrenOf.set(parent, list);
  }
  const placed = (stId: string, order: number) => {
    const name = byStId.get(stId)?.name;
    // String.compareTo on a null name is Java's NullPointerException.
    if (name === null || name === undefined) throw new JavaNullPointer(`no name: ${stId}`);
    return { stId, name, order };
  };
  const written = new Map<string, EventsHierarchyNode>();
  const write = (stId: string): EventsHierarchyNode => {
    const known = written.get(stId);
    if (known) return known;
    const pathway = byStId.get(stId);
    const size = sizes.get(stId);
    const children = treeSetOf(
      (childrenOf.get(stId) ?? []).map(({ stId: child, order }) => placed(child, order))
    ).map(({ stId: child }) => write(child));
    // In SizedPathwayBrowserNode's @JsonPropertyOrder; a missing name or type
    // is left out, as Jackson leaves out a null (never seen). No analysis yet,
    // so no llp, entities or reactions (T103c).
    const node: JsonWritten<EventsHierarchyNode> = {
      stId,
      name: pathway?.name as string,
      species: speciesName,
      type: pathway?.type as EventsHierarchyNode['type'],
      diagram: pathway?.diagram ?? false,
      llp: undefined,
      totalEntity: size?.totalEntity ?? 0,
      totalEntityAndInteractors: size?.totalEntityAndInteractors ?? 0,
      entities: undefined,
      reactions: undefined,
      children: children.length ? children : undefined,
    };
    written.set(stId, node as EventsHierarchyNode);
    return node as EventsHierarchyNode;
  };
  const tree = treeSetOf(tops.map(({ stId }, order) => placed(stId, order))).map(({ stId }) =>
    write(stId)
  );
  return { tree, json: javaJson(tree) };
}

const pathwaysOnlyBySpecies = new Map<
  string,
  Promise<{ tree: EventsHierarchyNode[]; json: string }>
>();

/** pathwaysOnlyTree, kept per species; a failed build is tried again next time. */
function cachedPathwaysOnly(taxId: string, speciesName: string) {
  let tree = pathwaysOnlyBySpecies.get(taxId);
  if (!tree) {
    tree = pathwaysOnlyTree(taxId, speciesName);
    tree.catch(() => pathwaysOnlyBySpecies.delete(taxId));
    pathwaysOnlyBySpecies.set(taxId, tree);
  }
  return tree;
}

/**
 * Whether analysis-core built a hierarchy for a species: one for each
 * species with a top-level pathway (SpeciesRepository.getSpecies), keyed by
 * the Species itself.
 */
async function hasHierarchy(dbId: number) {
  const rows = await read<{ n: number }>(
    'MATCH (t:TopLevelPathway)-[:species]->(:Species {dbId: $dbId}) RETURN count(t) AS n',
    { dbId: neo4j.int(dbId) }
  );
  return Number(rows[0]?.n ?? 0) > 0;
}

/**
 * analysis-core's Tokenizer.getName: the token URL-decoded until it no longer
 * changes, then Base64-decoded -- each step's failure Java's own message,
 * which the content service answers as a 500. The decoded token is what the
 * AnalysisService is asked with; the name is the result file's.
 */
function tokenName(token: string) {
  let aux = javaUrlDecode(token);
  while (aux !== token) {
    token = aux;
    aux = javaUrlDecode(token);
  }
  const bytes = javaBase64Decode(aux);
  // The AnalysisService is asked with the bytes' canonical spelling: Java's
  // decoder ignores unused trailing bits, so `M/` opens what `Mw` opens.
  return {
    canonical: Buffer.from(bytes).toString('base64'),
    name: new TextDecoder().decode(bytes),
  };
}

/**
 * Tokenizer.shouldBeAlive, for a token the AnalysisService cannot be asked
 * about (its decoded form holds a '/'): whether its name starts with a date,
 * yyyyMMddHHmmss before an underscore, at most seven days ago. Read as fourteen
 * digits, which every token analysis-core makes is; SimpleDateFormat's lenient
 * reading of anything else is not followed.
 */
function shouldBeAlive(name: string) {
  if (!name.includes('_')) return false;
  const date = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/.exec(name.split('_')[0] ?? '');
  if (!date) return false;
  const [, y, mo, d, h, mi, se] = date.map(Number) as number[];
  const when = new Date(y as number, (mo as number) - 1, d, h, mi, se);
  return Math.floor((Date.now() - when.getTime()) / 86_400_000) <= 7;
}

/** A pathway of the AnalysisService's /token answer, as it writes one. */
interface StoredPathway {
  stId: string;
  llp: boolean;
  entities?: Record<string, unknown>;
  reactions?: Record<string, unknown>;
}

class StoredResultFailure extends Error {}

/**
 * The stored result's pathways, as the AnalysisService's /token gives them
 * for a resource: computed with the analysis's own interactors, every pathway
 * the analysis found for TOTAL, those that found something for a resource.
 * A token it does not have is analysis-core's "Not Found", or "Gone" for one
 * that should still be alive.
 */
const storedResults = new Map<string, Promise<StoredResult>>();
const STORED_FOR_MS = 5 * 60_000;

type StoredResult = { interactors: boolean; pathways: Map<string, StoredPathway> };

/**
 * The stored result's pathways (see storedPathwaysOnce), kept five minutes
 * per token, resource and importableOnly: the Reacfoam asks again on each
 * switch of resource or interactors, and a large result is megabytes.
 */
function storedPathways(
  token: { canonical: string; name: string },
  resource: string,
  importableOnly: boolean
) {
  const key = `${token.canonical} ${resource} ${String(importableOnly)}`;
  let found = storedResults.get(key);
  if (!found) {
    found = storedPathwaysOnce(token, resource, importableOnly);
    storedResults.set(key, found);
    found.catch(() => storedResults.delete(key));
    setTimeout(() => storedResults.delete(key), STORED_FOR_MS).unref();
  }
  return found;
}

/**
 * The stored result's pathways, as the AnalysisService's /token gives them
 * for a resource: computed with the analysis's own interactors, every pathway
 * the analysis found for TOTAL, those that found something for a resource --
 * disease pathways included, as Java overlays every pathway the result holds
 * whatever the analysis was asked. A token it does not have is
 * analysis-core's "Not Found", or "Gone" for one that should still be alive;
 * the AnalysisService's own answer says which.
 */
async function storedPathwaysOnce(
  token: { canonical: string; name: string },
  resource: string,
  importableOnly: boolean
): Promise<StoredResult> {
  // A name whose canonical spelling holds a '/' has no token path: Tokenizer's
  // own rule decides. analysis-core never makes one.
  if (token.canonical.includes('/'))
    throw new StoredResultFailure(shouldBeAlive(token.name) ? 'Gone' : 'Not Found');
  const url =
    `${settings.analysisService()}/AnalysisService/token/${encodeURIComponent(token.canonical)}` +
    `?resource=${encodeURIComponent(resource)}&importableOnly=${String(importableOnly)}` +
    '&includeDisease=true';
  const answer = await fetch(url, { signal: AbortSignal.timeout(120_000) });
  if (answer.status === 404 || answer.status === 410) {
    const body = (await answer.json().catch(() => ({}))) as { code?: unknown };
    if (body.code === 404) throw new StoredResultFailure('Not Found');
    if (body.code === 410) throw new StoredResultFailure('Gone');
  }
  if (!answer.ok)
    throw new Error(`the AnalysisService answered ${answer.status} for a stored result`);
  const result = (await answer.json()) as {
    summary: { interactors: boolean };
    pathways: StoredPathway[];
  };
  return {
    interactors: result.summary.interactors,
    pathways: new Map(result.pathways.map((pathway) => [pathway.stId, pathway])),
  };
}

const num = (value: unknown) => (typeof value === 'number' ? value : undefined);

/** EntityStatistics as Jackson writes it, in its fields' order; a null left out. */
function entityStatistics(stats: {
  resource: string;
  total: number;
  found: number;
  ratio: number;
  curatedTotal?: number | undefined;
  curatedFound?: number | undefined;
  interactorsTotal?: number | undefined;
  interactorsFound?: number | undefined;
  pValue?: number | undefined;
  fdr?: number | undefined;
  exp?: unknown;
}) {
  const exp =
    Array.isArray(stats.exp) && stats.exp.length
      ? new RawJson(
          `[${(stats.exp as unknown[]).map((value) => (typeof value === 'number' ? javaDouble(value) : 'null')).join(',')}]`
        )
      : undefined;
  return new RawJson(
    nonEmptyJson([
      ['resource', stats.resource],
      ['total', stats.total],
      ['found', stats.found],
      ['ratio', stats.ratio, true],
      ['curatedTotal', stats.curatedTotal],
      ['curatedFound', stats.curatedFound],
      ['interactorsTotal', stats.interactorsTotal],
      ['interactorsFound', stats.interactorsFound],
      ['pValue', stats.pValue, true],
      ['fdr', stats.fdr, true],
      ['exp', exp],
    ])
  );
}

/** ReactionStatistics as Jackson writes it. */
function reactionStatistics(stats: {
  resource: string;
  total: number;
  found: number;
  ratio: number;
}) {
  return new RawJson(
    nonEmptyJson([
      ['resource', stats.resource],
      ['total', stats.total],
      ['found', stats.found],
      ['ratio', stats.ratio, true],
    ])
  );
}

/** A statistics object the AnalysisService wrote, written as the content service writes one. */
function restated(written: Record<string, unknown>) {
  return entityStatistics({
    resource: String(written['resource']),
    total: num(written['total']) ?? 0,
    found: num(written['found']) ?? 0,
    ratio: num(written['ratio']) ?? 0,
    curatedTotal: num(written['curatedTotal']),
    curatedFound: num(written['curatedFound']),
    interactorsTotal: num(written['interactorsTotal']),
    interactorsFound: num(written['interactorsFound']),
    pValue: num(written['pValue']),
    fdr: num(written['fdr']),
    exp: written['exp'],
  });
}

const restatedReactions = (written: Record<string, unknown>) =>
  reactionStatistics({
    resource: String(written['resource']),
    total: num(written['total']) ?? 0,
    found: num(written['found']) ?? 0,
    ratio: num(written['ratio']) ?? 0,
  });

/** One node's overlay: its llp, entities and reactions, as written. */
type Overlay = { llp: boolean; entities?: RawJson; reactions?: RawJson };

/**
 * AnalysedPathwayBrowserNode.initAnalysis's figures for every pathway the
 * stored result names (research D25): EntityStatistics and ReactionStatistics
 * built with the request's resource, interactors and importableOnly. The
 * AnalysisService builds the same objects with the analysis's own
 * interactors, for the pathways that found something; where the request's
 * interactors is the analysis's they are its, and the rest comes from the
 * graph's static figures (analysisFigures) and the found counts, p-values and
 * expression the AnalysisService gives. One combination is not exact: an
 * analysis run with interactors, asked without them and importableOnly,
 * which needs the importable entities found -- summed here over the main
 * resources' curated found.
 */
async function overlays(
  token: { canonical: string; name: string },
  figures: AnalysisFigures,
  {
    resource,
    interactors,
    importableOnly,
  }: { resource: string; interactors: boolean; importableOnly: boolean }
) {
  const mainResource = [...figures.species.resources.keys()].includes(resource)
    ? resource
    : undefined;
  // Every pathway the result names, and its llp, from the plain list: asked
  // with importableOnly, the AnalysisService leaves out one found only through
  // auxiliary resources, which Java still writes (with nothing importable found).
  const [total, all, byResource] = await Promise.all([
    storedPathways(token, 'TOTAL', importableOnly),
    storedPathways(token, 'TOTAL', false),
    mainResource ? storedPathways(token, mainResource, importableOnly) : undefined,
  ]);
  const analysed = total.interactors;
  const out = new Map<string, Overlay>();
  let plainTotal: Map<string, StoredPathway> | undefined;
  let importableFound: Map<string, number> | undefined;
  if (resource === 'TOTAL' && interactors !== analysed && importableOnly) {
    if (analysed) {
      // Importable entities found: the main resources' curated found, summed.
      importableFound = new Map();
      const mains = [...figures.species.resources.keys()].filter(
        (main) => !['NCBI_PROTEIN', 'EMBL', 'COMPOUND', 'PUBCHEM_COMPOUND'].includes(main)
      );
      for (const { pathways } of await Promise.all(
        mains.map((main) => storedPathways(token, main, false))
      ))
        for (const [stId, pathway] of pathways)
          importableFound.set(
            stId,
            (importableFound.get(stId) ?? 0) + (num(pathway.entities?.['curatedFound']) ?? 0)
          );
    } else plainTotal = all.pathways;
  }
  for (const [stId, base] of all.pathways) {
    const overlay: Overlay = { llp: base.llp };
    out.set(stId, overlay);
    const figure = figures.pathways.get(stId);
    const stored = total.pathways.get(stId);
    if (resource === 'TOTAL' && !stored) {
      // Nothing importable found: the importable figures, nothing found.
      if (!figure) continue;
      const counts = figure.importable;
      const species = figures.species.combined;
      const plain = base.entities ?? {};
      overlay.entities = entityStatistics({
        resource: 'TOTAL',
        total: interactors ? counts.entitiesAndInteractors : counts.entities,
        found: 0,
        ratio: interactors
          ? counts.entitiesAndInteractors / species.entitiesAndInteractors
          : counts.entities / species.entities,
        ...(interactors && {
          curatedTotal: figure.combined.entities,
          curatedFound: (analysed ? num(plain['curatedFound']) : num(plain['found'])) ?? 0,
          interactorsTotal: figure.combined.interactors,
          interactorsFound: analysed ? (num(plain['interactorsFound']) ?? 0) : 0,
        }),
      });
      overlay.reactions = reactionStatistics({
        resource: 'TOTAL',
        total: counts.reactions,
        found: 0,
        ratio: counts.reactions / species.reactions,
      });
      continue;
    }
    if (resource === 'TOTAL' && stored) {
      const entities = stored.entities ?? {};
      if (stored.reactions) overlay.reactions = restatedReactions(stored.reactions);
      if (interactors === analysed || !figure) {
        overlay.entities = restated(entities);
        continue;
      }
      const counts = importableOnly ? figure.importable : figure.combined;
      const species = figures.species.combined;
      const found = interactors
        ? (num(entities['found']) ?? 0)
        : importableOnly
          ? (importableFound?.get(stId) ?? 0)
          : (num(entities['curatedFound']) ?? 0);
      const curatedFound = analysed
        ? num(entities['curatedFound'])
        : importableOnly
          ? num(plainTotal?.get(stId)?.entities?.['found'])
          : num(entities['found']);
      overlay.entities = entityStatistics({
        resource: 'TOTAL',
        total: interactors ? counts.entitiesAndInteractors : counts.entities,
        found,
        ratio: interactors
          ? counts.entitiesAndInteractors / species.entitiesAndInteractors
          : counts.entities / species.entities,
        ...(interactors && {
          curatedTotal: figure.combined.entities,
          curatedFound: curatedFound ?? 0,
          interactorsTotal: figure.combined.interactors,
          interactorsFound: analysed ? (num(entities['interactorsFound']) ?? 0) : 0,
        }),
        pValue: num(entities['pValue']),
        fdr: num(entities['fdr']),
        exp: entities['exp'],
      });
      continue;
    }
    // A resource the pathway's data holds, by its exact name; anything else
    // is the llp alone.
    const counts = mainResource ? figure?.resources.get(mainResource) : undefined;
    if (!mainResource || !counts || !byResource) continue;
    const species = figures.species.resources.get(mainResource);
    if (!species) continue;
    const found = byResource.pathways.get(stId);
    const entities = found?.entities;
    if (found && entities && interactors === analysed) {
      overlay.entities = restated(entities);
      if (found.reactions) overlay.reactions = restatedReactions(found.reactions);
      continue;
    }
    const ratioOf = (part: number, whole: number) => {
      const ratio = part / whole;
      return Number.isFinite(ratio) ? ratio : 0;
    };
    overlay.entities = entityStatistics({
      resource: mainResource,
      total: interactors ? counts.entitiesAndInteractors : counts.entities,
      found: entities
        ? interactors || !analysed
          ? (num(entities['found']) ?? 0)
          : (num(entities['curatedFound']) ?? 0)
        : 0,
      ratio: interactors
        ? ratioOf(counts.entitiesAndInteractors, species.entitiesAndInteractors)
        : counts.entities / species.entities,
      ...(interactors && {
        curatedTotal: counts.entities,
        curatedFound: entities
          ? ((analysed ? num(entities['curatedFound']) : num(entities['found'])) ?? 0)
          : 0,
        interactorsTotal: counts.interactors,
        interactorsFound: entities && analysed ? (num(entities['interactorsFound']) ?? 0) : 0,
      }),
      pValue: num(entities?.['pValue']),
      fdr: num(entities?.['fdr']),
      exp: entities?.['exp'],
    });
    overlay.reactions = found?.reactions
      ? restatedReactions(found.reactions)
      : reactionStatistics({
          resource: mainResource,
          total: counts.reactions,
          found: 0,
          ratio: counts.reactions / species.reactions,
        });
  }
  return out;
}

/**
 * The tree with the overlay, as Jackson writes AnalysedPathwayBrowserNode:
 * from each top-level pathway down, a node the result names gets its llp and
 * figures and its children are overlaid in turn; one it does not name is left
 * as it is, and so is everything below it. Java collects a named node's
 * children into a HashSet, so its order there changes from one request to
 * the next; here they keep the tree's.
 */
function overlaidJson(
  node: EventsHierarchyNode,
  overlay: Map<string, Overlay>,
  descend: boolean
): string {
  const mine = descend ? overlay.get(node.stId) : undefined;
  const children = node.children?.length
    ? new RawJson(
        `[${node.children.map((child) => overlaidJson(child, overlay, mine !== undefined)).join(',')}]`
      )
    : undefined;
  return nonEmptyJson([
    ['stId', node.stId],
    ['name', node.name],
    ['species', node.species],
    ['type', node.type],
    ['diagram', node.diagram],
    ['llp', mine?.llp],
    ['totalEntity', node.totalEntity],
    ['totalEntityAndInteractors', node.totalEntityAndInteractors],
    ['entities', mine?.entities],
    ['reactions', mine?.reactions],
    ['children', children],
  ]);
}

/** One TopLevelPathway's row of the event hierarchy query: the pathway, and its paths. */
type EventHierarchyRow = { db: LocationStep; nodePairCollection: LocationStep[][] | null };

/**
 * HierarchyRepository.getEventHierarchyByTaxIdRaw and BySpeciesNameRaw, as
 * written, with Event as the class: the rows' order is part of the answer
 * (parseHierarchy), so the text is Java's to the space -- by name it is
 * another query, whose order leaves the paths attached where they do not
 * belong.
 */
const EVENT_HIERARCHY_BY_TAX_ID =
  'MATCH (s:Species{taxId:$taxId})<-[:species]-(n:TopLevelPathway)MATCH path=(n)-[:hasEvent*]->(m:Event) ' +
  'WITH *, relationships(path) AS r ' +
  'RETURN [n.stId, n.displayName, n.hasDiagram, n.speciesName, n.schemaClass, labels(n), 0] AS db, ' +
  'collect( [rel IN r | [endNode(rel).stId, endNode(rel).displayName, endNode(rel).hasDiagram, endNode(rel).speciesName, endNode(rel).schemaClass, labels(endNode(rel)), rel.order ]] ) AS nodePairCollection';
const EVENT_HIERARCHY_BY_NAME =
  'MATCH path=(n:TopLevelPathway{speciesName:$speciesName})-[:hasEvent*]->(m:Event) ' +
  'WITH *, relationships(path) AS r ' +
  'RETURN [n.stId, n.displayName, n.hasDiagram, n.speciesName, n.schemaClass, labels(n), 0] AS db, ' +
  'collect ( [rel IN r | [endNode(rel).stId, endNode(rel).displayName, endNode(rel).hasDiagram, endNode(rel).speciesName, endNode(rel).schemaClass, labels(endNode(rel)), rel.order ]] ) AS nodePairCollection';

/** Java's StackOverflowError: copying a tree that holds a cycle never ends. */
class JavaStackOverflow extends Error {}

/**
 * The full event hierarchy (graph-core's HierarchyService.getEventHierarchy,
 * pathwaysOnly false): each top-level pathway's paths parsed as parseRaw
 * parses them (parseHierarchy, every event kept), the roots in a TreeSet --
 * equal ones are one -- then each node as SizedPathwayBrowserNode copies it,
 * with the sizes of a pathway the analysis hierarchy holds, 0 for any other
 * event. A number is a taxId, anything else a TopLevelPathway's speciesName,
 * as given. No rows is Java's NullPointerException; a cycle, its
 * StackOverflowError.
 */
async function fullTree(
  raw: string,
  sizes: Map<string, { totalEntity: number; totalEntityAndInteractors: number }>
) {
  const rows = javaNumeric(raw)
    ? await read<EventHierarchyRow>(EVENT_HIERARCHY_BY_TAX_ID, { taxId: raw })
    : await read<EventHierarchyRow>(EVENT_HIERARCHY_BY_NAME, { speciesName: raw });
  if (rows.length === 0) throw new JavaNullPointer('no event hierarchy');
  let roots: PathwayBrowserNode[] | null = null;
  for (const row of rows)
    roots = sortedAdd(roots, parseHierarchy(row.db, row.nodePairCollection, false));
  const onPath = new Set<PathwayBrowserNode>();
  const written = new Map<PathwayBrowserNode, EventsHierarchyNode>();
  const write = (node: PathwayBrowserNode): EventsHierarchyNode => {
    if (onPath.has(node)) throw new JavaStackOverflow();
    const known = written.get(node);
    if (known) return known;
    onPath.add(node);
    const children = (node.children ?? []).map(write);
    onPath.delete(node);
    const size = node.stId === undefined ? undefined : sizes.get(node.stId);
    // In SizedPathwayBrowserNode's @JsonPropertyOrder; a null left out.
    const out: JsonWritten<EventsHierarchyNode> = {
      stId: node.stId as string,
      name: node.name as string,
      species: node.species as string,
      type: node.type as string,
      diagram: node.diagram as boolean,
      llp: undefined,
      totalEntity: size?.totalEntity ?? 0,
      totalEntityAndInteractors: size?.totalEntityAndInteractors ?? 0,
      entities: undefined,
      reactions: undefined,
      children: children.length ? children : undefined,
    };
    written.set(node, out as EventsHierarchyNode);
    return out as EventsHierarchyNode;
  };
  const tree = (roots ?? []).map(write);
  return { tree, json: javaJson(tree) };
}

const fullTrees = new Map<string, Promise<{ tree: EventsHierarchyNode[]; json: string }>>();

/**
 * fullTree, kept per species as asked (a taxId, or a name). Java's
 * StackOverflowError is kept too: it is the release's answer for that name,
 * and working it out again costs seconds of the event loop. Only a taxId or a
 * top-level pathway's exact speciesName gets that far, so the cache stays
 * small; any other failure -- no rows, which any spelling reaches -- is tried
 * again next time. A species without a taxId has an empty analysis hierarchy:
 * every size 0.
 */
function cachedFullTree(raw: string, taxId: string | null) {
  let tree = fullTrees.get(raw);
  if (!tree) {
    tree = (
      taxId
        ? analysisSizes(taxId)
        : Promise.resolve(
            new Map<string, { totalEntity: number; totalEntityAndInteractors: number }>()
          )
    ).then((sizes) => fullTree(raw, sizes));
    tree.catch((error: unknown) => {
      if (!(error instanceof JavaStackOverflow)) fullTrees.delete(raw);
    });
    fullTrees.set(raw, tree);
  }
  return tree;
}

/**
 * EventsController.getEventHierarchy (spec 006 T103, research D25): its
 * parameters read in its order, each Boolean as Spring binds one; the species
 * as SpeciesService finds it, a species without a hierarchy -- none found, or
 * no top-level pathway -- being Java's NullPointerException; the
 * pathwaysOnly tree (T103b) or the full one (T103d), with Content-Disposition
 * naming the species as given; and with a token, the analysis overlay
 * (T103c).
 */
async function eventsHierarchy(request: Request) {
  const raw = pathId(rawSegment(request, 4));
  const pathwaysOnly = springBoolean(queryValues(request, 'pathwaysOnly'));
  if (pathwaysOnly.error !== undefined)
    return javaError(request, 400, 'BAD_REQUEST', pathwaysOnly.error);
  // A String with no default: an empty one is still a token, as Java reads it.
  const tokens = queryValues(request, 'token');
  // A String with a default: absent or one empty value is TOTAL.
  const resources = queryValues(request, 'resource');
  const resource =
    resources.length === 0 || (resources.length === 1 && resources[0] === '')
      ? 'TOTAL'
      : resources.join(',');
  const interactors = springBoolean(queryValues(request, 'interactors'));
  if (interactors.error !== undefined)
    return javaError(request, 400, 'BAD_REQUEST', interactors.error);
  const importableOnly = springBoolean(queryValues(request, 'importableOnly'));
  if (importableOnly.error !== undefined)
    return javaError(request, 400, 'BAD_REQUEST', importableOnly.error);

  const found = await hierarchySpecies(raw);
  if (found.failure !== undefined)
    return javaError(request, 500, 'INTERNAL_SERVER_ERROR', found.failure);
  if (found.ambiguous || !found.species || !(await hasHierarchy(found.species.dbId)))
    return unexpectedFailure(request);
  const { taxId, displayName } = found.species;
  // HierarchyBuilder leaves the hierarchy of a species without a taxId empty,
  // and EventsController answers an empty pathwaysOnly tree with its 404; the
  // full form asks graph-core all the same. None in release 98.
  if (!taxId && pathwaysOnly.value === true)
    return notFound(request, `No event hierarchy found for given species: ${raw}`);
  let built;
  try {
    // The full form asks graph-core by the species as given (fullTree).
    built =
      pathwaysOnly.value === true
        ? await cachedPathwaysOnly(taxId as string, displayName)
        : await cachedFullTree(raw, taxId);
  } catch (error) {
    if (error instanceof JavaNullPointer) return unexpectedFailure(request);
    if (error instanceof JavaStackOverflow)
      return javaError(
        request,
        500,
        'INTERNAL_SERVER_ERROR',
        'Handler dispatch failed; nested exception is java.lang.StackOverflowError'
      );
    throw error;
  }
  if (built.tree.length === 0)
    return notFound(request, `No event hierarchy found for given species: ${raw}`);
  // Set before the token is read, so its failures carry it too.
  const headers = {
    // As Tomcat writes it: past Latin-1 a '?' (a species in Arabic-Indic digits).
    'Content-Disposition': tomcatHeader(
      `inline; swaggerDownload="attachment"; filename="${raw}.json"`
    ),
  };
  if (tokens.length === 0)
    return { status: 200, serialised: built.json, type: 'application/json', headers };

  // URLDecoder's and Base64's failures, then the stored result's "Not Found"
  // and "Gone": Java's 500, naming them.
  const refused = (message: string) => ({
    ...javaError(request, 500, 'INTERNAL_SERVER_ERROR', message),
    headers,
  });
  let token;
  try {
    token = tokenName(tokens.join(','));
  } catch (error) {
    return refused((error as Error).message);
  }
  let overlay;
  try {
    overlay = await overlays(token, await analysisFigures(taxId ?? ''), {
      resource,
      interactors: interactors.value ?? false,
      importableOnly: importableOnly.value ?? false,
    });
  } catch (error) {
    if (error instanceof StoredResultFailure) return refused(error.message);
    throw error;
  }
  return {
    status: 200,
    serialised: `[${built.tree.map((node) => overlaidJson(node, overlay, true)).join(',')}]`,
    type: 'application/json',
    headers,
  };
}

export const pathwaysEventsEndpoints: Endpoint[] = [
  {
    path: '/ContentService/data/eventsHierarchy/{id}',
    sample: '9606?pathwaysOnly=true',
    // The 404 and 500 bodies name the service that answered.
    differs: [/^\/ContentService\/data\/eventsHierarchy\/[^/:]+[^:]*: \.url: /],
    /**
     * The Reacfoam's tree (spec 006 T103, research D25): every pathway of a
     * species with its size. The pathwaysOnly form without a token is
     * answered (T103b); the token overlay and the full tree follow (T103c,
     * T103d), and nginx sends the route to node only then.
     */
    handler: eventsHierarchy,
  },
  {
    path: '/ContentService/data/pathways/top/{id}',
    // Compared by default. Without a sample this endpoint expanded to nothing
    // and sat in the table unexamined for weeks.
    sample: '9606',
    /**
     * The 404 body names the service that answered, so two services on
     * different ports must disagree about it -- the field is doing its job.
     * Behind nginx they agree, because `proxy_set_header Host $host` gives both
     * the same external name. Declared narrowly: only `.url`, and only here.
     */
    differs: [/^\/ContentService\/data\/pathways\/top\/\d+: \.url: /],
    /**
     * The top-level pathways for a species, which is the pathway browser's first
     * request and the release checklist's "29 clicks".
     *
     * Three details the shape depends on, each learned from the Java response
     * rather than assumed:
     *  - fields whose property is absent are *omitted*, not null (doi and
     *    releaseStatus are on a minority of pathways, lastUpdatedDate on 28 of
     *    29). Jackson drops nulls, so emitting them would differ on every item.
     *  - `className` repeats `schemaClass`; the graph stores only the latter.
     *  - `species` is an array of one object, and it carries a different field
     *    set from the pathway: no stId, no dates.
     */
    handler: async (request) => {
      // As Spring binds it: decoded from the segment as sent (pathId).
      const taxId = pathId(rawSegment(request, 5));
      // content-service decodes the species once more (URLDecoder), so
      // 'Homo+sapiens' finds human; a malformed escape is Java's 500. The 404
      // message below names the species before that decoding, as Java's does.
      let decoded: string;
      try {
        decoded = javaUrlDecode(taxId);
      } catch (failure) {
        return javaError(request, 500, 'INTERNAL_SERVER_ERROR', (failure as Error).message);
      }
      const { where, params } = topSpeciesMatch(decoded);
      const rows = await read<{ pathway: Props; species: Props }>(
        `MATCH (p:TopLevelPathway)-[:species]->(s:Species)
         WHERE ${where}
         RETURN properties(p) AS pathway, properties(s) AS species
         // toLower, as /content/toc already does. Neo4j orders by code point,
         // so uppercase sorts before lowercase and "DNA Repair" landed before
         // "Developmental Biology"; Java's collation is case-insensitive.
         ORDER BY toLower(p.displayName)`,
        params
      );
      // Java answers 404, not an empty list, when a species has no top-level
      // pathways -- checked for both an unknown id and taxId 1, which exists.
      if (!rows.length) {
        return notFound(request, `No TopLevelPathways were found for species: ${taxId}`);
      }

      // Scoped to this response: the back-reference is only meaningful within
      // the document it appears in.
      const seenSpecies = new Set();
      const full = (species: Props) => {
        seenSpecies.add(species.dbId);
        return {
          ...only(species, ['dbId', 'displayName', 'name', 'taxId', 'abbreviation']),
          className: species.schemaClass,
          schemaClass: species.schemaClass,
        };
      };

      const body = rows.map(({ pathway, species }) =>
        // Jackson writes a repeated object once and then refers back to it by
        // dbId -- the default of the service-wide `includeRef` parameter, which
        // only changes the *form* of the back-reference to JSOG `{@ref}`. So
        // all 29 human pathways share one Species and only the first carries it.
        //
        // Not a nicety: emitting the object 29 times is a different response
        // shape, and a caller written against Java's would read `species[0]` as
        // a number on all but the first item. Nothing caught this because the
        // diff expands `{id}` only when given `--ids`, so this endpoint had
        // never once been compared.
        topPathwayJson(pathway, seenSpecies.has(species.dbId) ? species.dbId : full(species))
      );
      return { status: 200, body, type: 'application/json' };
    },
  },
  {
    path: '/ContentService/data/pathways/top/{id}/curated',
    sample: '9606',
    // The 404 body names the service that answered; see /pathways/top/{id}.
    differs: [/^\/ContentService\/data\/pathways\/top\/[^/]+\/curated: \.url: /],
    /**
     * A species' top-level pathways that are not inferred (spec 006 T106):
     * graph-core's getCuratedTopLevelPathways, its query as written
     * (curatedTopQuery) and mapped as SDN maps its records, written in the
     * request's view. The species is the path's, decoded once: unlike
     * /pathways/top/{species}, the controller does not decode it again. None
     * is Java's 404, naming the species.
     */
    handler: async (request) => {
      const species = pathId(rawSegment(request, 5));
      const byTaxId = javaNumeric(species);
      const rows = await read<{
        n: GraphNode;
        'collect(r)': GraphRelationship[];
        'collect(s)': GraphNode[];
      }>(curatedTopQuery(byTaxId), byTaxId ? { taxId: species } : { speciesName: species }, {
        graph: true,
      });
      if (!rows.length)
        return notFound(request, `No TopLevelPathways were found for species: ${species}`);
      const pathways = mapResults(
        rows.map((row) => ({
          root: row.n,
          nodes: row['collect(s)'],
          relationships: row['collect(r)'],
        }))
      );
      return {
        status: 200,
        serialised: writeDomain(pathways, ...writerFor(request)),
        type: 'application/json',
      };
    },
  },
  {
    path: '/ContentService/data/event/{id}/ancestors',
    // A reaction reached by two routes, so the comparison covers more than one path.
    sample: 'R-HSA-5672965',
    // The 404 body names the service that answered; see /pathways/top/{id}.
    differs: [/^\/ContentService\/data\/event\/[^/]+\/ancestors: \.url: /],
    /**
     * Every route from an event up to a top-level pathway, each as a list that
     * starts at the event itself. A top-level pathway is its own single route.
     *
     * The Pathway Browser asks for this on every pathway it opens, to place it
     * in the hierarchy and to find a diagram for a pathway that has none.
     *
     * Java's query, kept: one match for "is a top-level pathway", one for the
     * paths up, joined by UNION, which also drops repeated routes. The id is
     * resolved first on the indexed DatabaseObject properties (see resolveId)
     * rather than as `:Event{stId}`, and the labels checked after.
     *
     * The fields are graph-core's EventProjection, in the order Jackson writes
     * it: field-backed properties in declaration order, then `inferred` and
     * `inDisease`, whose getters do not match their `is...` fields. Absent
     * values are omitted, except the ones the projection defaults: false for
     * the flags, 0 for the diagram size.
     */
    handler: async (request) => {
      const raw = pathId(rawSegment(request, 4));
      const { where, params } = resolveId(raw);
      const rows = await read<{ nodes: Props[] }>(
        `MATCH (n:DatabaseObject) WHERE ${where}
         WITH n LIMIT 1
         MATCH (n:TopLevelPathway)
         RETURN [n] AS nodes
         UNION
         MATCH (n:DatabaseObject) WHERE ${where}
         WITH n LIMIT 1
         MATCH route = (n:Event)<-[:hasEvent*]-(:TopLevelPathway)
         RETURN nodes(route) AS nodes`,
        params
      );
      if (rows.length === 0) return notFound(request, `No ancestors found for given event: ${raw}`);
      return {
        status: 200,
        body: rows.map((row) => row.nodes.map(eventProjection)),
        type: 'application/json',
      };
    },
  },
  {
    path: '/ContentService/data/pathways/low/entity/{id}',
    // A protein in ten lower-level pathways: every row of the answer is mapped.
    sample: 'R-HSA-199420',
    // The 404 body names the service that answered; see /pathways/top/{id}.
    differs: [/^\/ContentService\/data\/pathways\/low\/entity\/[^/]+: \.url: /],
    /**
     * The lower-level pathways an entity or event takes part in, optionally in
     * one species. The Pathway Browser asks for it from the entity popup and
     * the participating-pathways list ("where else does this appear?").
     *
     * Java's three queries, kept as graph-core writes them
     * (PathwayRepository.getPathwaysFor*): pathways that reach the object
     * through any participant relationship, pathways that contain it as a
     * reaction, and the object itself if it is a pathway, joined by UNION.
     * Kept as written rather than tidied, because the row order of the answer
     * is the order those queries produce. The id and species are read by
     * lowerLevelPathways.
     */
    handler: (request) => lowerLevelPathways(request, 6, PATHWAYS_FOR),
  },
  {
    path: '/ContentService/data/pathways/low/entity/{id}/allForms',
    // A protein's every form: 12 pathways; ATP's run to 2.3MB.
    sample: 'R-HSA-199420',
    differs: [/^\/ContentService\/data\/pathways\/low\/entity\/[^/]+\/allForms: \.url: /],
    /**
     * The lower-level pathways any form of an entity takes part in: every
     * reference entity under it, then every entity with that reference
     * entity, up to its reactions' pathways. As /low/entity/{id} reads its id
     * and species (lowerLevelPathways); the query is graph-core's
     * getPathwaysForAllFormsOf*.
     */
    handler: (request) => lowerLevelPathways(request, 6, PATHWAYS_FOR_ALL_FORMS),
  },
  {
    path: '/ContentService/data/pathways/low/diagram/entity/{id}',
    // A protein drawn in seven diagrams.
    sample: 'R-HSA-199420',
    differs: [/^\/ContentService\/data\/pathways\/low\/diagram\/entity\/[^/]+: \.url: /],
    /**
     * The diagrams an entity, a reaction or a pathway is drawn in: for each
     * reaction it reaches, the first pathway above it with a diagram. As
     * /low/entity/{id} reads its id and species; the query is graph-core's
     * getPathwaysWithDiagramFor*.
     */
    handler: (request) => lowerLevelPathways(request, 7, PATHWAYS_WITH_DIAGRAM_FOR),
  },
  {
    path: '/ContentService/data/pathways/low/diagram/entity/{id}/allForms',
    sample: 'R-HSA-199420',
    differs: [/^\/ContentService\/data\/pathways\/low\/diagram\/entity\/[^/]+\/allForms: \.url: /],
    /**
     * The diagrams any form of an entity is drawn in: /allForms's reference
     * entities, then /diagram/entity's first diagram above each reaction.
     * graph-core's getPathwaysWithDiagramForAllFormsOf*.
     */
    handler: (request) => lowerLevelPathways(request, 7, PATHWAYS_WITH_DIAGRAM_FOR_ALL_FORMS),
  },
  {
    path: '/ContentService/data/pathways/low/diagram/identifier/{id}/allForms',
    // Seconds, even walked from the identifier (identifierAllFormsQuery).
    deep: true,
    sample: 'PTEN?species=9606',
    differs: [
      /^\/ContentService\/data\/pathways\/low\/diagram\/identifier\/[^/]+\/allForms[^:]*: \.url: /,
    ],
    /**
     * The lower-level pathways an outside identifier's entities take part in
     * (spec 006 T106): PathwaysService.getLowerLevelPathwaysForIdentifier on
     * the identifier upper-cased, in the species SpeciesService finds
     * (speciesFilter). Without one -- none given, or none found -- graph-core's
     * query asks for a parameter it never binds, and Java's answer is Neo4j's
     * refusal as its 500 (identifierAllFormsQuery): run here as Java runs it,
     * so the message is Neo4j's own. None found is the 404 naming the
     * identifier and the species as given.
     */
    handler: async (request) => {
      const raw = pathId(rawSegment(request, 7));
      const given = queryValues(request, 'species');
      const species = given.length ? given.join(',') : undefined;
      const taxId = await speciesTaxId(speciesFilter(species));
      const identifier = raw.toUpperCase();
      let rows: { p: GraphNode }[];
      try {
        rows = await read<{ p: GraphNode }>(
          identifierAllFormsQuery(taxId !== undefined),
          taxId === undefined ? { identifier } : { identifier, taxId },
          { graph: true }
        );
      } catch (failure) {
        const message = neo4jFailureMessage(failure, [
          'Neo.ClientError.Statement.ParameterMissing',
        ]);
        if (message) return javaError(request, 500, 'INTERNAL_SERVER_ERROR', message);
        throw failure;
      }
      if (!rows.length)
        return notFound(
          request,
          `No result for ${raw} in ${species === undefined ? 'null' : species}`
        );
      return {
        status: 200,
        serialised: writeDomain(
          mapResults(rows.map((row) => ({ root: row.p, nodes: [], relationships: [] }))),
          ...writerFor(request)
        ),
        type: 'application/json',
      };
    },
  },
  {
    path: '/ContentService/data/diagram/{id}/entities/{instance}',
    sample: 'R-HSA-1257604',
    samplePath: { instance: 'PTEN' },
    differs: [/^\/ContentService\/data\/diagram\/[^/]+\/entities\/[^/]+[^:]*: \.url: /],
    /**
     * The entities of a diagram an identifier names, and those of the
     * `pathways` given (twenty at most) that it is in: the Pathway Browser's
     * flag targets (spec 006 T106). PathwaysController's
     * getEntitiesInDiagramForIdentifier, on the identifier upper-cased:
     * graph-core's two lookups (diagramEntities, pathwaysForIdentifier), their
     * objects gathered in a HashSet, so written in its order. None is the 404
     * naming the identifier and pathway as given, and the pathways if any
     * were (diagramPathways).
     */
    handler: async (request) => {
      const pathwayId = pathId(rawSegment(request, 4));
      const given = pathId(rawSegment(request, 6));
      const identifier = given.toUpperCase();
      const pathways = diagramPathways(queryValues(request, 'pathways'));
      const answer = simpleObjectSet();
      const inDiagram = await diagramEntities(pathwayId, identifier);
      if ('failure' in inDiagram)
        return javaError(request, 500, 'INTERNAL_SERVER_ERROR', inDiagram.failure);
      for (const row of inDiagram.rows) addTo(answer, simpleObject(row));
      if (pathways !== null) {
        const among = await pathwaysForIdentifier(identifier, pathways);
        if ('failure' in among)
          return javaError(request, 500, 'INTERNAL_SERVER_ERROR', among.failure);
        for (const object of among.found) addTo(answer, object);
      }
      if (answer.size === 0)
        return notFound(
          request,
          `No entities with identifier '${given}' found for ${pathwayId}` +
            (pathways !== null ? ` nor for pathways [${pathways.join(', ')}]` : '')
        );
      return { status: 200, body: [...answer.values()], type: 'application/json' };
    },
  },
  {
    path: '/ContentService/data/pathway/{id}/containedEvents',
    // Apoptosis' intrinsic pathway: 82 events below it.
    sample: 'R-HSA-109606',
    differs: [/^\/ContentService\/data\/pathway\/[^/]+\/containedEvents: \.url: /],
    /**
     * Every event below a pathway, at any depth, written whole: graph-core's
     * EventRepository.getContainedEventsBy*, run as written and mapped as
     * Neo4jTemplate.findAll maps it (containedEvents). None is Java's 404.
     */
    handler: async (request) => {
      const raw = pathId(rawSegment(request, 4));
      const refused = containedEventsFailure(request, raw);
      if (refused) return refused;
      const events = await containedEvents(raw);
      if (!events.length)
        return notFound(request, `No contained events found in the given event: ${raw}`);
      return {
        status: 200,
        serialised: writeDomain(events, ...writerFor(request)),
        type: 'application/json',
      };
    },
  },
  {
    path: '/ContentService/data/pathway/{id}/containedEvents/{attribute}',
    sample: 'R-HSA-109606',
    samplePath: { attribute: 'stId' },
    differs: [/^\/ContentService\/data\/pathway\/[^/]+\/containedEvents\/[^/]+: \.url: /],
    /**
     * One attribute of every event below a pathway, as Java's List.toString
     * writes the list ControllerUtils.getProperties makes: each event's
     * getter, as /data/query/{id}/{attributeName} calls it, its toTSV text
     * between brackets, ", " apart. An event without the attribute is
     * Java's 404 for the whole, naming the event's class.
     */
    handler: async (request) => {
      const raw = pathId(rawSegment(request, 4));
      const attribute = pathId(rawSegment(request, 6));
      const refused = containedEventsFailure(request, raw);
      if (refused) return refused;
      const events = await containedEvents(raw);
      if (!events.length)
        return notFound(request, `No contained events found in the given event: ${raw}`);
      const texts: string[] = [];
      for (const event of events) {
        // findAll's events carry only their hasEvent relationships: any
        // other is loaded when asked, outgoing ones too.
        const answer = await attributeOf(request, event, attribute, { outgoingLoaded: false });
        if ('status' in answer) return answer;
        texts.push(answer.text);
      }
      return { status: 200, body: `[${texts.join(', ')}]`, type: 'text/plain;charset=UTF-8' };
    },
  },
  {
    path: '/ContentService/data/detail/{id}/locationsInPWB',
    // Every route up to a diagram: seconds for a common small molecule.
    deep: true,
    // PTEN: 18 trees, reached through reactions, sets and complexes.
    sample: 'R-HSA-199420',
    // The error bodies name the service that answered; see /pathways/top/{id}.
    differs: [/^\/ContentService\/data\/detail\/[^/]+\/locationsInPWB(\?\S*)?: \.url: /],
    /**
     * Every place in the Pathway Browser an object appears: one tree per
     * top-level pathway, down to the object itself, each node with the address
     * that opens it there. The details page's "Locations in the Pathway
     * Browser" tree asks for it.
     *
     * graph-core's HierarchyService and HierarchyRepository, and the
     * controller's PathwayBrowserLocationsUtils, kept line for line
     * (parseHierarchy, locationsInPathwayBrowser): the query's paths are read
     * in the order Neo4j returns them and the answer depends on that order, so
     * the four queries match and expand as Java's do (locationsQuery). The id
     * is read as everywhere
     * else; a REACT_ id is swapped for its stable id first, as getIdentifier
     * does.
     *
     * Not cached: the answer is per id, and Java holds nothing either. Most
     * answer in tens of milliseconds; a common small molecule takes seconds in
     * both.
     *
     * `directParticipants` (default false) follows only the relationships that
     * put an entity directly in a reaction; `omitNonDisplayableItems` (default
     * true) leaves catalyses and regulations out of the tree. Both are read as
     * Spring reads a Boolean, and a value it cannot read is its 400. Asking for
     * the non-displayable items is Java's 500 for most entities -- every node
     * without a stable id becomes one node, which makes cycles -- and here too.
     */
    handler: async (request) => {
      const raw = pathId(rawSegment(request, 4));
      // In the controller's parameter order: the first that cannot be read is
      // the one Java names.
      const direct = springBoolean(queryValues(request, 'directParticipants'));
      if (direct.error !== undefined) return javaError(request, 400, 'BAD_REQUEST', direct.error);
      const omit = springBoolean(queryValues(request, 'omitNonDisplayableItems'));
      if (omit.error !== undefined) return javaError(request, 400, 'BAD_REQUEST', omit.error);

      const missing = () =>
        javaError(request, 404, 'NOT_FOUND', `Reverse sub graph found for id: ${raw}`);
      const id = await graphCoreId(raw);
      if (!id) return missing();
      const { params, byDbId } = id;
      // Long.parseLong past a long's range is Java's 500, naming the digits as
      // given; neo4j.int would wrap round instead and find some other object.
      if (byDbId && BigInt(params.id) > 9223372036854775807n) {
        const digits = javaTrim(raw).split('.')[0];
        return javaError(request, 500, 'INTERNAL_SERVER_ERROR', `For input string: "${digits}"`);
      }
      const rows = await read<LocationsRow>(
        locationsQuery(byDbId, direct.value ?? false),
        byDbId ? { dbId: neo4j.int(params.id) } : { stId: params.id }
      );
      const [row] = rows;
      if (!row) return missing();

      try {
        // One row per path; no path at all is one row with none, which Java's
        // collect drops.
        const paths = rows
          .map((each) => each.steps)
          .filter((steps): steps is LocationStep[] => steps !== null);
        const root = parseHierarchy(row.db, paths, omit.value ?? true);
        const trees = locationsInPathwayBrowser(root);
        if (trees.length === 0) {
          return javaError(
            request,
            404,
            'NOT_FOUND',
            `No Locations in the PathwayBrowser could have been found for id: ${raw}`
          );
        }
        return { status: 200, body: trees.map(pathwayBrowserJson), type: 'application/json' };
      } catch (failure) {
        // The two ways graph-core fails on this graph, answered as Java answers
        // them: a cycle overflows the stack, which Spring reports by name, and
        // a null it dereferences is the generic message.
        if (failure instanceof RangeError) {
          return javaError(
            request,
            500,
            'INTERNAL_SERVER_ERROR',
            'Handler dispatch failed; nested exception is java.lang.StackOverflowError'
          );
        }
        if (failure instanceof JavaNullPointer) {
          return javaError(
            request,
            500,
            'INTERNAL_SERVER_ERROR',
            'Something unexpected happened and the error has been reported.'
          );
        }
        throw failure;
      }
    },
  },
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
];
