/**
 * The reaction layout's answer as Java writes it (research D22, step 4):
 * `Map.of("diagram", …, "graph", …)` through ContentService's mapper, which
 * is Jackson 2.13 with NON_EMPTY inclusion. So:
 * - each object's fields come in the order Jackson gives diagram-reader
 *   1.2.5's classes, read by serialising each class, every field set, with
 *   the deployed jars (the orders are in answer.spec.ts). A field Java never
 *   sets here (a node's `innerProp`, `insets`, colours and the like; an
 *   edge's `reactionType`, `endShape`, preceding and following events; a
 *   reaction part's `points`; a diagram's notes, links and shadows) is null
 *   or empty, so left out, and not listed;
 * - null, empty text and empty lists are left out; 0 and false are written;
 * - a Double is written as Java's Double.toString (10.0, 1.0E-4, -0.0), a
 *   Long or Integer as its digits; no whitespace.
 *
 * The two top keys' order follows a seed Java picks when it starts (D22):
 * `diagram` first, as most starts give.
 */
import { javaDouble, javaString } from '../domain.ts';
import type { Answer } from '../endpoint.ts';
import { layOut } from './algorithm.ts';
import type { Laid } from './algorithm.ts';
import { reactionDiagram } from './diagram.ts';
import type { ReactionDiagram } from './diagram.ts';
import { readInputs } from './inputs.ts';
import { reactionGraph } from './reaction-graph.ts';
import type { EntityNode, EventNode, ReactionGraph } from './reaction-graph.ts';
import type { Coordinate, Shape, Stoichiometry } from './shapes.ts';
import type { Segment } from './sizes.ts';

/** A double member: written as Java's Double.toString. */
const DOUBLE = true;

/** Text already written as JSON. */
class RawJson {
  readonly text: string;
  constructor(text: string) {
    this.text = text;
  }
}

type Value =
  string | number | boolean | readonly (string | number | null)[] | RawJson | null | undefined;

/** One member: its name, its value, and whether a number is a Double. */
type Member = [name: string, value: Value, double?: boolean];
type Members = Member[];

/** A value as Jackson writes it; a null in a list is `null`. */
function written(value: Exclude<Value, undefined>, double = false): string {
  if (value === null) return 'null';
  if (value instanceof RawJson) return value.text;
  if (Array.isArray(value)) return `[${value.map((item) => written(item)).join(',')}]`;
  if (typeof value === 'string') return javaString(value);
  if (typeof value === 'number') return double ? javaDouble(value) : String(value);
  return String(value);
}

/**
 * An object as the NON_EMPTY mapper writes it: the members in order, any
 * null, empty text or empty list left out. (The service's answers.ts has
 * the same for its families; a library imports only leaves.)
 */
function nonEmptyJson(members: Members): string {
  const out: string[] = [];
  for (const [name, value, double] of members) {
    if (value === null || value === undefined || value === '') continue;
    if (Array.isArray(value) && !value.length) continue;
    out.push(`${javaString(name)}:${written(value, double)}`);
  }
  return `{${out.join(',')}}`;
}

/** A list of objects, written; null (left out) when empty. */
function list<T>(items: readonly T[], write: (item: T) => string): RawJson | null {
  return items.length ? new RawJson(`[${items.map(write).join(',')}]`) : null;
}

/** An object written already, or null to leave it out. */
const object = <T>(value: T | null | undefined, write: (value: T) => string) =>
  value === null || value === undefined ? null : new RawJson(write(value));

/** CoordinateImpl: x, y. */
const coordinate = (c: Coordinate) =>
  nonEmptyJson([
    ['x', c.x, DOUBLE],
    ['y', c.y, DOUBLE],
  ]);

/** SegmentImpl: from, to. */
const segment = (s: Segment) =>
  nonEmptyJson([
    ['from', new RawJson(coordinate(s.from))],
    ['to', new RawJson(coordinate(s.to))],
  ]);

/** ShapeImpl and its kinds: a, b, c, r, r1, s, type, empty. */
const shape = (s: Shape) =>
  nonEmptyJson([
    ['a', object(s.a, coordinate)],
    ['b', object(s.b, coordinate)],
    ['c', object(s.c, coordinate)],
    ['r', s.r, DOUBLE],
    ['r1', s.r1, DOUBLE],
    ['s', s.s],
    ['type', s.type],
    ['empty', s.empty],
  ]);

/** StoichiometryImpl: value (an Integer), shape. */
const stoichiometry = (s: Stoichiometry) =>
  nonEmptyJson([
    ['value', s.value],
    ['shape', object(s.shape, shape)],
  ]);

/** NodePropertiesImpl: x, y, width, height. */
const prop = (p: { x: number; y: number; width: number; height: number }) =>
  nonEmptyJson([
    ['x', p.x, DOUBLE],
    ['y', p.y, DOUBLE],
    ['width', p.width, DOUBLE],
    ['height', p.height, DOUBLE],
  ]);

type Diagram = ReactionDiagram;
type Node = Diagram['nodes'][number];
type Edge = Diagram['edges'][number];
type Compartment = Diagram['compartments'][number];
type Placed = Node | Edge | Compartment;

/** DiagramObjectImpl's fields, up to its position. */
const head = (o: Placed): Members => [
  ['id', o.id],
  ['reactomeId', o.reactomeId],
  ['displayName', o.displayName],
  ['schemaClass', o.schemaClass],
  ['renderableClass', o.renderableClass],
  ['position', new RawJson(coordinate(o.position))],
];

/** DiagramObjectImpl's bounds, doubles. */
const bounds = (o: Placed): Members => [
  ['minX', o.minX, DOUBLE],
  ['minY', o.minY, DOUBLE],
  ['maxX', o.maxX, DOUBLE],
  ['maxY', o.maxY, DOUBLE],
];

/** ConnectorImpl: edgeId, isDisease, type, isFadeOut (never set), segments, endShape, stoichiometry. */
const connector = (c: Node['connectors'][number]) =>
  nonEmptyJson([
    ['edgeId', c.edgeId],
    ['isDisease', c.isDisease],
    ['type', c.type],
    ['segments', list(c.segments, segment)],
    ['endShape', object(c.endShape, shape)],
    ['stoichiometry', object(c.stoichiometry, stoichiometry)],
  ]);

/** NodeAttachmentImpl: label, description (never set), reactomeId, shape. */
const attachment = (a: Node['nodeAttachments'][number]) =>
  nonEmptyJson([
    ['label', a.label],
    ['reactomeId', a.reactomeId],
    ['shape', new RawJson(shape(a.shape))],
  ]);

/** NodeImpl. isFadeOut and isCrossed follow `crossed`, which is never set (D22). */
const node = (n: Node) =>
  nonEmptyJson([
    ...head(n),
    ['isDisease', n.isDisease],
    ...bounds(n),
    ['prop', new RawJson(prop(n.prop))],
    ['nodeAttachments', list(n.nodeAttachments, attachment)],
    ['connectors', list(n.connectors, connector)],
    ['trivial', n.trivial],
    ['needDashedBorder', n.needDashedBorder],
  ]);

/** ReactionPartImpl: id, points (never set), stoichiometry (an Integer). */
const part = (p: { id: number; stoichiometry: number }) =>
  nonEmptyJson([
    ['id', p.id],
    ['stoichiometry', p.stoichiometry],
  ]);

/** EdgeImpl. */
const edge = (e: Edge) =>
  nonEmptyJson([
    ...head(e),
    ['isDisease', e.isDisease],
    ...bounds(e),
    ['segments', list(e.segments, segment)],
    ['reactionShape', new RawJson(shape(e.reactionShape))],
    ['inputs', list(e.inputs, part)],
    ['outputs', list(e.outputs, part)],
    ['catalysts', list(e.catalysts, part)],
    ['inhibitors', list(e.inhibitors, part)],
    ['activators', list(e.activators, part)],
  ]);

/** CompartmentImpl. */
const compartment = (c: Compartment) =>
  nonEmptyJson([
    ...head(c),
    ...bounds(c),
    ['prop', new RawJson(prop(c.prop))],
    ['textPosition', new RawJson(coordinate(c.textPosition))],
    ['componentIds', c.componentIds],
  ]);

/** DiagramImpl: its bounds are ints, (int) of the layout's. */
const diagramJson = (d: Diagram) =>
  nonEmptyJson([
    ['isDisease', d.isDisease],
    ['displayName', d.displayName],
    ['nodes', list(d.nodes, node)],
    ['edges', list(d.edges, edge)],
    ['compartments', list(d.compartments, compartment)],
    ['dbId', d.dbId],
    ['stableId', d.stableId],
    ['minX', d.minX],
    ['maxX', d.maxX],
    ['minY', d.minY],
    ['maxY', d.maxY],
  ]);

/** EntityNodeImpl. */
const entityNode = (n: EntityNode) =>
  nonEmptyJson([
    ['parents', n.parents],
    ['children', n.children],
    ['identifier', n.identifier],
    ['geneNames', n.geneNames],
    ['diagramIds', n.diagramIds],
    ['dbId', n.dbId],
    ['stId', n.stId],
    ['displayName', n.displayName],
    ['schemaClass', n.schemaClass],
    ['speciesID', n.speciesID],
  ]);

/**
 * EventNodeImpl. Jackson names its properties by their getters: the field
 * `efs` is `entityFunctionalStatus` and `speciesId` is `speciesID`. Matching
 * no field, the two come after those that do, in the order the JVM lists the
 * class's methods, which follows what it loaded before (D22): the deployed
 * service writes `entityFunctionalStatus` first.
 */
const eventNode = (n: EventNode) =>
  nonEmptyJson([
    ['preceding', n.preceding],
    ['following', n.following],
    ['inputs', n.inputs],
    ['outputs', n.outputs],
    ['catalysts', n.catalysts],
    ['inhibitors', n.inhibitors],
    ['activators', n.activators],
    ['requirements', n.requirements],
    ['diagramIds', n.diagramIds],
    ['dbId', n.dbId],
    ['stId', n.stId],
    ['displayName', n.displayName],
    ['schemaClass', n.schemaClass],
    ['entityFunctionalStatus', n.efs],
    ['speciesID', n.speciesId],
  ]);

/** GraphImpl. */
const graphJson = (g: ReactionGraph) =>
  nonEmptyJson([
    ['dbId', g.dbId],
    ['stId', g.stId],
    ['displayName', g.displayName],
    ['speciesName', g.speciesName],
    ['nodes', list(g.nodes, entityNode)],
    ['edges', list(g.edges, eventNode)],
    ['subpathways', g.subpathways],
  ]);

/** The answer's text: Map.of("diagram", diagram, "graph", graph), diagram first. */
export const answerJson = (diagram: Diagram, graph: ReactionGraph) =>
  `{"diagram":${diagramJson(diagram)},"graph":${graphJson(graph)}}`;

/** The answer's Content-Type, as the parity harness compares it: the media type. */
const ANSWER_TYPE = 'application/json';

/**
 * ImageExporterController.reactionJson for a reaction: laid out from glyph
 * id `first` (D22: the service starts at 1), the diagram, then the graph.
 * A failure is one of the library's Java exceptions; its answer is step 5's.
 */
export async function reactionAnswer(
  stId: string,
  first = 1
): Promise<{ laid: Laid; answer: Answer & { serialised: string } }> {
  const laid = layOut(await readInputs(stId, first));
  const diagram = reactionDiagram(laid);
  const graph = await reactionGraph(laid);
  return {
    laid,
    answer: { status: 200, type: ANSWER_TYPE, serialised: answerJson(diagram, graph) },
  };
}
