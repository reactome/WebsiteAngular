/**
 * The pathway and event endpoints (spec 014, research R1, a family): the
 * top-level and lower-level pathways (/data/pathways/*), a pathway's
 * contained events (/data/pathway/*), an event's ancestors and in-depth
 * tree (/data/event/*) and where an object sits in the Pathway Browser
 * (/data/detail/*), with the helpers only they use. Moved unchanged from
 * service.ts.
 */
import type { Endpoint } from './endpoint.ts';
import { javaError, notFound, only } from './answers.ts';
import { asciiDigits, javaNumeric, javaTrim, javaUtf8 } from './java-text.ts';
import type { Written } from './answers.ts';
import {
  attributeOf,
  graphCoreId,
  longPastRange,
  pathwayJson,
  resolveId,
  speciesFilter,
  speciesTaxId,
} from './objects.ts';
import { read } from './graph.ts';
import type { GraphNode, GraphRelationship } from './graph.ts';
import neo4j from 'neo4j-driver';
import { mapResults, writeDomain } from './domain.ts';
import { pathId, queryValues, rawSegment, springBoolean, writerFor } from './spring.ts';
import type { Props } from './objects.ts';

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
export function locationsQuery(byDbId, directParticipants) {
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
export function eventProjection(node) {
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
    hasDiagram: node.hasDiagram ?? false,
    hasEHLD: node.hasEHLD ?? false,
    diagramWidth: node.diagramWidth ?? 0,
    diagramHeight: node.diagramHeight ?? 0,
    ...only(node, ['category', 'isCanonical', 'definition']),
    inferred: node.isInferred ?? false,
    inDisease: node.isInDisease ?? false,
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
export function javaUrlDecode(text) {
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
function javaHexByte(two) {
  const digit = (ch) => {
    if (/^[0-9a-fA-F]$/.test(ch)) return parseInt(ch, 16);
    const code = ch.charCodeAt(0);
    // Fullwidth A-F and a-f, which Character.digit accepts.
    if (code >= 0xff21 && code <= 0xff26) return code - 0xff21 + 10;
    if (code >= 0xff41 && code <= 0xff46) return code - 0xff41 + 10;
    if (javaNumeric(ch)) return Number(asciiDigits(ch));
    return -1;
  };
  const refuse = (index) =>
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
    const d = digit(two[k]);
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
export function topSpeciesMatch(raw) {
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
export function topPathwayJson(pathway, species) {
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
    schemaClass: pathway.schemaClass,
    className: pathway.schemaClass,
  };
}

/**
 * What a NullPointerException would have been in Java: graph-core dereferences
 * a few values without checking them, and Java answers its generic 500 then.
 */
class JavaNullPointer extends Error {}

/** Java's String.compareTo: by UTF-16 unit, which is also what `<` compares. */
function javaCompare(a, b) {
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
  stId: string | undefined = undefined;
  name: string | undefined = undefined;
  species: string | undefined = undefined;
  url: string | undefined = undefined;
  type: string | undefined = undefined;
  diagram: boolean | undefined = undefined;
  unique: boolean | undefined = undefined;
  order: number | undefined = undefined;
  children: PathwayBrowserNode[] | null = null;
  parent: PathwayBrowserNode[] | null = null;

  addChild(node) {
    this.children = sortedAdd(this.children, node);
  }

  addParent(node) {
    this.parent = sortedAdd(this.parent, node);
  }

  hasDiagram() {
    return this.diagram ?? false;
  }

  /** PathwayBrowserNode.compareTo. */
  compareTo(node) {
    const species = javaCompare(this.species ?? '', node.species ?? '');
    if (species !== 0) return species;
    const order = (this.order ?? 0) - (node.order ?? 0);
    if (order !== 0) return order;
    return javaCompare(this.name, node.name);
  }

  /** getLeaves: a TreeSet, so leaves that compare equal are one. */
  getLeaves() {
    if (this.children === null) return [this];
    let leaves: PathwayBrowserNode[] | null = null;
    for (const child of this.children) {
      for (const leaf of child.getLeaves()) leaves = sortedAdd(leaves, leaf);
    }
    return leaves ?? [];
  }
}

/** TreeSet.add: in compareTo order, and nothing added when an equal one is there. */
function sortedAdd(set, node) {
  const list = set ?? [];
  // TreeMap.put on an empty map still compares the key with itself.
  if (list.length === 0) node.compareTo(node);
  let low = 0;
  let high = list.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    const order = node.compareTo(list[middle]);
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
function treeItem(row) {
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
function displayable(type) {
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
export function parseHierarchy(rootRow, paths, omitNonDisplayableItems) {
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
  const addNode = (previous, row) => {
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
      previous = addNode(previous, path[path.length - 1]);
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
export function locationsInPathwayBrowser(root) {
  const leaves = root.getLeaves().filter((leaf) => leaf.type === 'TopLevelPathway');
  let trees: PathwayBrowserNode[] | null = null;
  for (const leaf of leaves) trees = sortedAdd(trees, treeFromLeaf(leaf, '', '', '', ''));
  return trees ?? [];
}

function treeFromLeaf(leaf, sel, path, shortPath, lastNodeWithDiagram) {
  const tree = new PathwayBrowserNode();
  tree.stId = leaf.stId;
  tree.name = leaf.name;
  tree.species = leaf.species;
  tree.type = leaf.type;

  if (leaf.type === null || leaf.type === undefined) throw new JavaNullPointer('type');
  const isPathway = PATHWAY_TYPES.has(leaf.type);
  const hasDiagram = leaf.hasDiagram();
  leaf.unique = false;

  let main;
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
      const only = children[0].unique;
      if (only === null || only === undefined) throw new JavaNullPointer('isUnique');
      if (only) leaf.unique = true;
    }
  }

  // StringBuilder.append(null) writes "null".
  const text = (value) => (value === null || value === undefined ? 'null' : String(value));
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
export function pathwayBrowserJson(node: PathwayBrowserNode) {
  const out: Written & { children?: Written[] } = only(node, [
    'stId',
    'name',
    'species',
    'url',
    'type',
    'diagram',
  ]);
  if (node.children?.length) out.children = node.children.map(pathwayBrowserJson);
  return out;
}

/**
 * What graph-core's getContainedEvents throws on before it asks anything:
 * an id of dots, which trimId splits to nothing (Java's 500 with no
 * message), and a dbId past a long (Long.parseLong's). Undefined otherwise.
 */
function containedEventsFailure(request, raw) {
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
async function containedEvents(raw) {
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
const PATHWAYS_FOR = {
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

const PATHWAYS_FOR_ALL_FORMS = {
  column: 'p',
  query: (object, species) =>
    `MATCH (:DatabaseObject${object})-[:${FORMS_OF}]->(re:ReferenceEntity)
     WITH re
     MATCH (re)<-[:referenceEntity]-(:PhysicalEntity)<-[:${PARTICIPANT_OF}]-(:ReactionLikeEvent)<-[:hasEvent]-(p:Pathway)${species('(:Species{taxId:$taxId})')}
     RETURN DISTINCT p`,
};

const PATHWAYS_WITH_DIAGRAM_FOR = {
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

const PATHWAYS_WITH_DIAGRAM_FOR_ALL_FORMS = {
  column: 'm',
  query: (object, species) =>
    `MATCH (:PhysicalEntity${object})-[:${FORMS_OF}]->(re:ReferenceEntity)
     WITH re
     MATCH (re)<-[:referenceEntity]-(:PhysicalEntity)<-[:${PARTICIPANT_OF}]-(r:ReactionLikeEvent)<-[:hasEvent*]-(p:Pathway{hasDiagram:True})${species('(Species{taxId:$taxId})')}
     WITH r, HEAD(COLLECT(p)) AS m
     RETURN DISTINCT m`,
};

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
async function lowerLevelPathways(request, segment, { column, query }) {
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
  const inSpecies = (pattern) => (taxId === undefined ? '' : `-[:species]->${pattern}`);
  const rows = await read<{ [column: string]: Props }>(query(object, inSpecies), {
    ...params,
    ...(taxId === undefined ? {} : { taxId }),
  });
  if (rows.length === 0) return missing();
  return {
    status: 200,
    body: rows.map((row) => pathwayJson(row[column])),
    type: 'application/json',
  };
}

export const pathwaysEventsEndpoints: Endpoint[] = [
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
      let decoded;
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
      const full = (species) => {
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
        const paths = rows.map((each) => each.steps).filter((steps) => steps !== null);
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
];
