/**
 * The reaction layout comparison (spec 006 T092, research D22): node's
 * answer against Java's /exporter/reaction/{id}/diagram. Node runs in
 * process from the first glyph id Java's answer shows (its edge's), so the
 * two make the same glyphs with the same ids. Steps 1 to 4 compare:
 * - the status and the Content-Type's media type, as the parity harness
 *   compares them;
 * - the whole diagram and graph in the site's canonical form (canonical.ts),
 *   numbers within a billionth of Java's value's size, or 1e-9 below 1
 *   (compare-json.ts, research D22's declared sin and cos difference);
 * - each glyph id with what it is: node ids with their entity, compartment
 *   ids with their compartment, the edge's with the reaction -- so a glyph
 *   made out of Java's order shows here;
 * - the orders Java's hash sets give the nodes, the compartments, each
 *   compartment's components and the edge's parts, and the order of each
 *   node's connectors, when everything else agrees;
 * - then the raw text, byte for byte but for the declared differences
 *   (raw-text.ts): what the canonical form cannot see -- number formatting,
 *   whitespace, field order, what is left out -- and the graph's own orders.
 *
 *   JAVA_CONTENT_SERVICE=http://localhost:8080 node tools/content-node/reaction-layout-check.ts [count | stId...]
 *
 * Reactions: the stable ids given, or `count` at random (default 200), every reaction with no
 * compartment, and some failed reactions, disease ones, ones with drugs among
 * or inside their participants, heavily modified proteins, genes and cells,
 * ones across many compartments, and regulated ones and ones with entity
 * functional statuses, for the graph. An answer whose ids alone differ is
 * asked again (another request may have taken ids in between), up to three
 * times. One whose diagram, graph or orders differ is asked again up to
 * REACTION_LAYOUT_ATTEMPTS times (default 24, D21): Java's layout, and which
 * glyph of an entity drawn twice keeps which role, can follow the random
 * order of a participant's roles, and a match on any attempt is a match. Once
 * Java has drawn the same REACTION_LAYOUT_STEADY times (default 4) it stops,
 * and reports the reaction to be looked at by hand -- unless all that differs
 * is the order of a node's connectors, which follows the roles' random order
 * however Java draws; 24 gives D21's miss rate. A Java error
 * must meet an error from node; its text is step 5's. Spaced for the shared
 * database; stops after 20 differences in a row. Prints reaction ids, counts
 * and paths into the answer only. Exits 1 on any difference.
 */
import { sameWithin } from './reaction-layout/compare-json.ts';
import { close, read } from './graph.ts';
import { reactionAnswer } from './reaction-layout/answer.ts';
import { canonicalReaction } from './reaction-layout/canonical.ts';
import type { CanonicalDiagram } from './reaction-layout/canonical.ts';
import { JavaNullPointerException, JavaRuntimeException } from './reaction-layout/model.ts';
import { rawDifference } from './reaction-layout/raw-text.ts';

const JAVA = process.env['JAVA_CONTENT_SERVICE'] || 'http://localhost:8080';
const ATTEMPTS = Number(process.env['REACTION_LAYOUT_ATTEMPTS'] || 24);

/** A JSON value, as the answer is parsed. */
type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

/** The answer, as far as the comparison reads it. Jackson leaves out what is null or empty. */
interface JavaPart {
  id: number;
}
interface JavaPlaced {
  id: number;
  reactomeId: number;
  renderableClass: string;
  position: { x: number; y: number };
}
interface JavaDiagram {
  displayName: string;
  nodes?: (JavaPlaced & { connectors?: { edgeId: number; type: string; segments: [] }[] })[];
  edges: [
    JavaPlaced & {
      inputs?: JavaPart[];
      outputs?: JavaPart[];
      catalysts?: JavaPart[];
      inhibitors?: JavaPart[];
      activators?: JavaPart[];
    },
  ];
  compartments?: (JavaPlaced & { displayName: string; componentIds?: number[] })[];
  links?: CanonicalDiagram['links'];
}
interface JavaGraph {
  nodes?: { dbId: number; diagramIds?: number[] }[];
  edges?: { dbId: number }[];
}
interface JavaAnswer {
  diagram: JavaDiagram;
  graph: JavaGraph;
}

/** One side's answer: its status, media type and text. */
interface Side {
  status: number;
  type: string;
  text: string;
}

/** What is compared, part by part. */
interface Summary {
  /** The canonical diagram, as JSON. */
  diagram: string;
  /** The canonical graph, its diagram ids numbered as the diagram's, as JSON. */
  graph: string;
  ids: string[];
  /** The orders Java's hash sets and maps give, by glyph id, and each node's connectors'. */
  orders: string;
  /**
   * The orders with each node's connectors' types sorted: what is left when
   * the roles' random order (D21) is set aside.
   */
  unroled: string;
}

const PART_LISTS = ['inputs', 'outputs', 'catalysts', 'inhibitors', 'activators'] as const;

/** A list compared as a multiset: each item as JSON, sorted. */
const sorted = (items: unknown[]) => items.map((item) => JSON.stringify(item)).sort();

/** The answer in canonical form, as the site puts it before drawing (its absent lists as empty). */
function canonical({ diagram, graph }: JavaAnswer): { diagram: Json; graph: Json } {
  const complete = {
    ...diagram,
    nodes: (diagram.nodes ?? []).map((n) => ({ ...n, connectors: n.connectors ?? [] })),
    compartments: (diagram.compartments ?? []).map((c) => ({
      ...c,
      componentIds: c.componentIds ?? [],
    })),
    links: diagram.links ?? [],
  };
  const form = canonicalReaction(complete, {
    ...graph,
    nodes: graph.nodes ?? [],
    edges: graph.edges ?? [],
  });
  return form as unknown as { diagram: Json; graph: Json };
}

function summary(answer: JavaAnswer): Summary {
  const { diagram } = answer;
  const nodes = diagram.nodes ?? [];
  const compartments = diagram.compartments ?? [];
  const [edge] = diagram.edges;
  const form = canonical(answer);
  return {
    diagram: JSON.stringify(form.diagram),
    graph: JSON.stringify(form.graph),
    ids: sorted([
      ['reaction', edge.id, edge.reactomeId],
      ...nodes.map((node) => ['entity', node.id, node.reactomeId]),
      // A compartment only the GO tree supplies has no reactomeId: null in JSON.
      ...compartments.map((c) => ['compartment', c.id, c.displayName, c.reactomeId]),
    ]),
    orders: JSON.stringify([
      // With each node, its connectors' types: an entity both input and
      // catalyst has its connectors in its roles' random order (D21).
      nodes.map((node) => [node.id, (node.connectors ?? []).map((c) => c.type)]),
      compartments.map((c) => [c.id, c.componentIds ?? []]),
      PART_LISTS.map((list) => (edge[list] ?? []).map((part) => part.id)),
    ]),
    unroled: JSON.stringify([
      nodes.map((node) => [node.id, (node.connectors ?? []).map((c) => c.type).sort()]),
      compartments.map((c) => [c.id, c.componentIds ?? []]),
      PART_LISTS.map((list) => (edge[list] ?? []).map((part) => part.id)),
    ]),
  };
}

/**
 * Where two canonical forms first differ: a path into them, with the two
 * values when they are numbers -- never a name.
 */
function whereDiffers(java: Json, node: Json, path = ''): string {
  if (typeof java === 'number' && typeof node === 'number')
    return `${path} (java ${java}, node ${node})`;
  if (Array.isArray(java) && Array.isArray(node)) {
    if (java.length !== node.length)
      return `${path} (java ${java.length} items, node ${node.length})`;
    for (let i = 0; i < java.length; i += 1)
      if (!sameWithin(java[i] as Json, node[i] as Json))
        return whereDiffers(java[i] as Json, node[i] as Json, `${path}[${i}]`);
  } else if (
    java &&
    node &&
    typeof java === 'object' &&
    typeof node === 'object' &&
    !Array.isArray(java) &&
    !Array.isArray(node)
  ) {
    const keys = [...new Set([...Object.keys(java), ...Object.keys(node)])].sort();
    for (const key of keys)
      if (!(key in java && key in node && sameWithin(java[key] as Json, node[key] as Json)))
        return whereDiffers(java[key] ?? null, node[key] ?? null, `${path}.${key}`);
  }
  return path || '.';
}

/** Which parts of two summaries differ; the orders only when all else agrees. */
function differences(java: Summary, node: Summary): string[] {
  const parts: string[] = (['diagram', 'graph', 'ids'] as const).filter((key) =>
    key === 'ids'
      ? JSON.stringify(java[key]) !== JSON.stringify(node[key])
      : !sameWithin(JSON.parse(java[key]) as Json, JSON.parse(node[key]) as Json)
  );
  if (!parts.length && java.orders !== node.orders) parts.push('orders');
  return parts;
}

async function reactions(count: number): Promise<string[]> {
  const rows = await read<{ stId: string }>(
    `CALL { MATCH (r:ReactionLikeEvent) WHERE r.stId IS NOT NULL
            RETURN r.stId AS stId ORDER BY rand() LIMIT toInteger($count)
      UNION MATCH (r:ReactionLikeEvent) WHERE NOT (r)-[:compartment]->() RETURN r.stId AS stId
      UNION MATCH (r:FailedReaction) RETURN r.stId AS stId LIMIT 10
      UNION MATCH (r:ReactionLikeEvent {isInDisease: true}) RETURN r.stId AS stId LIMIT 10
      UNION MATCH (r:ReactionLikeEvent)-[:input|output|catalystActivity|physicalEntity|regulatedBy|regulator*1..3]->(pe:PhysicalEntity)
            WHERE (pe)-[:hasComponent|hasMember|hasCandidate*0..2]->(:Drug)
            RETURN DISTINCT r.stId AS stId LIMIT 20
      UNION MATCH (r:ReactionLikeEvent)-[:input|output]->(pe)
            WHERE NOT (pe)-[:compartment]->() RETURN DISTINCT r.stId AS stId LIMIT 10
      UNION MATCH (r:ReactionLikeEvent)-[:input|output]->(pe:EntityWithAccessionedSequence)
            WHERE size([(pe)-[:hasModifiedResidue]->(m:TranslationalModification) | m]) > 8
            RETURN DISTINCT r.stId AS stId LIMIT 15
      UNION MATCH (r:ReactionLikeEvent)-[:input|output]->(:EntityWithAccessionedSequence)-[:referenceEntity]->(:ReferenceDNASequence)
            RETURN DISTINCT r.stId AS stId LIMIT 5
      UNION MATCH (r:ReactionLikeEvent)-[:input|output]->(:Cell) RETURN DISTINCT r.stId AS stId LIMIT 5
      UNION MATCH (r:ReactionLikeEvent)-[:input|output]->(:PhysicalEntity)-[:compartment]->(c:Compartment)
            WITH r, count(DISTINCT c) AS compartments WHERE compartments >= 4
            RETURN r.stId AS stId LIMIT 25
      UNION MATCH (r:ReactionLikeEvent)-[:regulatedBy]->(:Regulation) RETURN DISTINCT r.stId AS stId LIMIT 10
      UNION MATCH (r:ReactionLikeEvent)-[:entityFunctionalStatus]->() RETURN DISTINCT r.stId AS stId LIMIT 10 }
     RETURN DISTINCT stId`,
    { count: Math.trunc(count) }
  );
  return rows.map((row) => row.stId);
}

/** The media type of a Content-Type, as the parity harness compares it. */
const mediaType = (type: string | null) => (type ?? '').split(';')[0]?.trim() ?? '';

/** Java's answer for a reaction. */
async function java(stId: string): Promise<Side> {
  const response = await fetch(`${JAVA}/ContentService/exporter/reaction/${stId}/diagram`, {
    signal: AbortSignal.timeout(120_000),
  });
  const text = await response.text();
  await new Promise((resolve) => setTimeout(resolve, 150));
  return { status: response.status, type: mediaType(response.headers.get('content-type')), text };
}

/** The outcome of one reaction: the parts that differ, empty when none do. */
interface Outcome {
  parts: string[];
  /** Both sides failed: Java with its 500, node with one of the library's Java exceptions. */
  bothFailed?: boolean;
  /** The attempt Java's layout matched on, past the first. */
  attempt?: number;
  /** Where the answers first differed, on the last attempt. */
  where?: string;
}

const isJavaException = (error: unknown) =>
  error instanceof JavaNullPointerException || error instanceof JavaRuntimeException;

/**
 * Java's layout and graph, in canonical form: the same on two attempts when
 * Java drew the same thing. Its orders are not part of it -- they follow
 * where each request's ids began (D21), so they differ between attempts by
 * design.
 */
function fingerprint(summary: Summary): string {
  return summary.diagram + summary.graph;
}

/**
 * Attempts after which, Java having drawn the same each time, the asking
 * stops and the reaction is reported to be looked at by hand: most likely
 * node's difference, though a layout Java gives rarely can hide behind them.
 * A whole number from 2 (one answer proves nothing) to ATTEMPTS.
 */
const STEADY = Number(process.env['REACTION_LAYOUT_STEADY'] || 4);
if (!Number.isInteger(STEADY) || STEADY < 2) {
  console.error('REACTION_LAYOUT_STEADY must be a whole number of 2 or more');
  process.exit(2);
}

/** One reaction compared. */
async function compare(stId: string): Promise<Outcome> {
  const answers = new Set<string>();
  for (let attempt = 1; ; attempt += 1) {
    let answer: Side;
    let body: JavaAnswer | undefined;
    let first = 1;
    try {
      answer = await java(stId);
      if (answer.status === 200) {
        body = JSON.parse(answer.text) as JavaAnswer;
        first = body.diagram.edges[0].id;
      }
    } catch (error) {
      const name = (error as Error).name;
      return {
        parts: [
          name === 'SyntaxError' || name === 'TypeError'
            ? `java's answer unreadable (${name})`
            : `java request failed (${name})`,
        ],
      };
    }
    let made: Side | Error;
    try {
      const { answer: node } = await reactionAnswer(stId, first);
      made = { status: node.status, type: node.type ?? '', text: node.serialised };
    } catch (error) {
      made = error as Error;
    }
    if (!body) {
      if (answer.status === 500 && isJavaException(made)) return { parts: [], bothFailed: true };
      return {
        parts: [
          made instanceof Error
            ? `java ${answer.status}, node threw ${made.name}`
            : `java ${answer.status}, node answered`,
        ],
      };
    }
    if (made instanceof Error)
      return { parts: [`node threw ${made.name}: ${made.message.slice(0, 80)}`] };
    if (made.status !== answer.status || made.type !== answer.type)
      return {
        parts: [
          `status and type (java ${answer.status} ${answer.type}, node ${made.status} ${made.type})`,
        ],
      };
    let javaSummary: Summary;
    try {
      javaSummary = summary(body);
    } catch (error) {
      return { parts: [`java's answer unreadable (${(error as Error).name})`] };
    }
    const nodeSummary = summary(JSON.parse(made.text) as JavaAnswer);
    answers.add(fingerprint(javaSummary));
    const parts = differences(javaSummary, nodeSummary);
    // All else the same, the ids are Java's: the texts must be too.
    const text = parts.length ? undefined : rawDifference(answer.text, made.text);
    if (text) return { parts: ['text'], where: text };
    if (!parts.length) return attempt > 1 ? { parts, attempt } : { parts };
    const shape = parts.find((part) => part === 'diagram' || part === 'graph');
    const last: Outcome = shape
      ? {
          parts,
          where: `${shape}${whereDiffers(
            JSON.parse(javaSummary[shape]) as Json,
            JSON.parse(nodeSummary[shape]) as Json
          )}`,
        }
      : { parts };
    // Ids alone differing may be another request's ids in between: ask again.
    if (parts.length === 1 && parts[0] === 'ids' && attempt < 3) continue;
    // A layout or an order that differs may be one of Java's others -- which of
    // an entity's roles keeps the glyph and which goes to its copy, and the
    // order of its connectors, follow the roles' random order (D21): ask
    // again, up to ATTEMPTS -- but once Java has drawn the same STEADY times
    // it is probably not varying, so stop asking on the shared database and
    // report it (below). Orders alone are stopped so too, unless all that
    // differs is the order of a node's connectors: Java draws the same while
    // that varies, an entity both input and catalyst's connectors one way or
    // the other on each request, so only asking again can find node's order.
    // Any other order node is given Java's ids for, and should match at once.
    const roles = javaSummary.unroled === nodeSummary.unroled;
    const orders = parts.includes('orders');
    const steady =
      attempt >= STEADY && answers.size === 1 && (shape !== undefined || (orders && !roles));
    if ((shape || orders) && attempt < ATTEMPTS && !steady) continue;
    // Stopped early, Java having answered the same each time: most likely
    // node's, but a layout Java gives rarely can hide behind four of its
    // usual one -- to look at by hand, or ask again with
    // REACTION_LAYOUT_STEADY=24 for D21's rate.
    return steady && attempt < ATTEMPTS
      ? { ...last, parts: [...last.parts, `Java the same ${attempt} times: look at by hand`] }
      : last;
  }
}

async function main() {
  const asked = process.argv.slice(2);
  const ids = asked.some((arg) => arg.startsWith('R-'))
    ? asked
    : await reactions(Number(asked[0] ?? 200));
  console.log(`comparing ${ids.length} reactions, steps 1 to 4 (up to ${ATTEMPTS} attempts each)`);
  let identical = 0;
  let bothFailed = 0;
  let retried = 0;
  let different = 0;
  let inARow = 0;
  for (const stId of ids) {
    const { parts, bothFailed: failed, attempt, where } = await compare(stId);
    if (!parts.length) {
      if (failed) bothFailed += 1;
      else identical += 1;
      if (attempt) {
        retried += 1;
        console.log(`  ${stId}: identical to Java's answer on attempt ${attempt}`);
      }
      inARow = 0;
      continue;
    }
    different += 1;
    inARow += 1;
    console.log(`  ${stId}: ${parts.join(', ')} differ${where ? ` -- first at ${where}` : ''}`);
    if (inARow >= 20) {
      console.log('stopped: 20 differences in a row');
      break;
    }
  }
  await close();
  console.log(
    `compared: ${identical} identical (${retried} of them on a later attempt), ` +
      `${bothFailed} failing on both sides (texts are step 5's), ${different} different`
  );
  process.exit(different ? 1 : 0);
}

await main();
