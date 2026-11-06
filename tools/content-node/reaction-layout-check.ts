/**
 * The reaction layout comparison (spec 006 T092, research D22): node's
 * layout against Java's /exporter/reaction/{id}/diagram, on the parts the
 * steps built so far decide. Node runs in process from the first glyph id
 * Java's answer shows (its edge's), so the two make the same glyphs with the
 * same ids. Step 3 compares:
 * - the whole diagram in the site's canonical form (canonical.ts), with
 *   every position exact. What Jackson leaves out and the order it writes
 *   fields in are step 4's, so null and empty fields are dropped from node's
 *   side, as Java's answer has them, and keys are compared sorted;
 * - each glyph id with what it is: node ids with their entity, compartment
 *   ids with their compartment, the edge's with the reaction -- so a glyph
 *   made out of Java's order shows here;
 * - the orders Java's hash sets give the nodes, the compartments, each
 *   compartment's components and the edge's parts, when everything else
 *   agrees;
 * - the reaction's species, from the graph, until step 4 compares the graph.
 *
 *   JAVA_CONTENT_SERVICE=http://localhost:8080 node tools/content-node/reaction-layout-check.ts [count | stId...]
 *
 * Reactions: the stable ids given, or `count` at random (default 200), every reaction with no
 * compartment, and some failed reactions, disease ones, ones with drugs among
 * or inside their participants, heavily modified proteins, genes and cells,
 * and ones across many compartments. An answer whose ids alone differ is
 * asked again (another request may have taken ids in between), up to three
 * times. One whose diagram or orders differ is asked again up to
 * REACTION_LAYOUT_ATTEMPTS times (default 24, D21): Java's layout, and which
 * glyph of an entity drawn twice keeps which role, can follow the random
 * order of a participant's roles, and a match on any attempt is a match. A Java error
 * must meet an error from node; its text is step 5's. Spaced for the shared
 * database; stops after 20 differences in a row. Prints reaction ids, counts
 * and paths into the diagram only. Exits 1 on any difference.
 */
import { sameWithin } from './reaction-layout/compare-json.ts';
import { close, read } from './graph.ts';
import { layOut } from './reaction-layout/algorithm.ts';
import { canonicalReaction } from './reaction-layout/canonical.ts';
import type { CanonicalDiagram } from './reaction-layout/canonical.ts';
import { reactionDiagram } from './reaction-layout/diagram.ts';
import type { ReactionDiagram } from './reaction-layout/diagram.ts';
import { readInputs } from './reaction-layout/inputs.ts';
import type { Inputs } from './reaction-layout/inputs.ts';
import { JavaNullPointerException, JavaRuntimeException } from './reaction-layout/model.ts';

const JAVA = process.env['JAVA_CONTENT_SERVICE'] || 'http://localhost:8080';
const ATTEMPTS = Number(process.env['REACTION_LAYOUT_ATTEMPTS'] || 24);

/** A JSON value, as the answer is parsed. */
type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

/** Java's diagram, as far as the comparison reads it. Jackson leaves out what is null or empty. */
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
interface JavaAnswer {
  diagram: JavaDiagram;
  graph?: { speciesName?: string };
}

/** What is compared, part by part. */
interface Summary {
  /** The canonical diagram, keys sorted, as JSON. */
  diagram: string;
  ids: string[];
  /** The orders Java's hash sets and maps give, by glyph id. */
  orders: string;
  species: string | null;
}

const PART_LISTS = ['inputs', 'outputs', 'catalysts', 'inhibitors', 'activators'] as const;

/** A list compared as a multiset: each item as JSON, sorted. */
const sorted = (items: unknown[]) => items.map((item) => JSON.stringify(item)).sort();

/**
 * What Jackson writes of a value (NON_EMPTY): no null fields and no empty
 * lists, at any depth. Applied to node's diagram, which keeps Java's nulls.
 */
function jackson(value: Json): Json {
  if (Array.isArray(value)) return value.map(jackson);
  if (value === null || typeof value !== 'object') return value;
  const kept: { [key: string]: Json } = {};
  for (const [key, inner] of Object.entries(value)) {
    if (inner === null || (Array.isArray(inner) && !inner.length)) continue;
    kept[key] = jackson(inner);
  }
  return kept;
}

/** A value with every object's keys sorted: key order is step 4's. */
function keysSorted(value: Json): Json {
  if (Array.isArray(value)) return value.map(keysSorted);
  if (value === null || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, keysSorted(value[key] as Json)])
  );
}

/** The diagram in canonical form, as the site puts it before drawing (its absent lists as empty). */
function canonical(diagram: JavaDiagram): Json {
  const complete = {
    ...diagram,
    nodes: (diagram.nodes ?? []).map((n) => ({ ...n, connectors: n.connectors ?? [] })),
    compartments: (diagram.compartments ?? []).map((c) => ({
      ...c,
      componentIds: c.componentIds ?? [],
    })),
    links: diagram.links ?? [],
  };
  const { diagram: form } = canonicalReaction(complete, { nodes: [], edges: [] });
  return keysSorted(form as unknown as Json);
}

function summary(diagram: JavaDiagram, species: string | null): Summary {
  const nodes = diagram.nodes ?? [];
  const compartments = diagram.compartments ?? [];
  const [edge] = diagram.edges;
  return {
    diagram: JSON.stringify(canonical(diagram)),
    ids: sorted([
      ['reaction', edge.id, edge.reactomeId],
      ...nodes.map((node) => ['entity', node.id, node.reactomeId]),
      // A compartment only the GO tree supplies has no reactomeId: null in JSON.
      ...compartments.map((c) => ['compartment', c.id, c.displayName, c.reactomeId]),
    ]),
    orders: JSON.stringify([
      nodes.map((node) => node.id),
      compartments.map((c) => [c.id, c.componentIds ?? []]),
      PART_LISTS.map((list) => (edge[list] ?? []).map((part) => part.id)),
    ]),
    species,
  };
}

/** Node's diagram as Java's answer would have it: laid out, then written as Jackson does. */
function nodeDiagram(inputs: Inputs): JavaDiagram {
  const diagram: ReactionDiagram = reactionDiagram(layOut(inputs));
  return jackson(JSON.parse(JSON.stringify(diagram)) as Json) as unknown as JavaDiagram;
}

/**
 * Where two canonical diagrams first differ: a path into them, with the two
 * values when they are numbers -- never a name.
 */
function whereDiffers(java: Json, node: Json, path = ''): string {
  if (typeof java === 'number' && typeof node === 'number')
    return `${path} (java ${java}, node ${node})`;
  if (Array.isArray(java) && Array.isArray(node)) {
    if (java.length !== node.length)
      return `${path} (java ${java.length} items, node ${node.length})`;
    for (let i = 0; i < java.length; i += 1)
      if (JSON.stringify(java[i]) !== JSON.stringify(node[i]))
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
      if (JSON.stringify(java[key]) !== JSON.stringify(node[key]))
        return whereDiffers(java[key] ?? null, node[key] ?? null, `${path}.${key}`);
  }
  return path || '.';
}

/** Which parts of two summaries differ; the orders only when all else agrees. */
function differences(java: Summary, node: Summary): string[] {
  const parts: string[] = (['diagram', 'ids', 'species'] as const).filter((key) =>
    key === 'diagram'
      ? !sameWithin(JSON.parse(java.diagram) as Json, JSON.parse(node.diagram) as Json)
      : JSON.stringify(java[key]) !== JSON.stringify(node[key])
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
            RETURN r.stId AS stId LIMIT 25 }
     RETURN DISTINCT stId`,
    { count: Math.trunc(count) }
  );
  return rows.map((row) => row.stId);
}

/** Java's answer for a reaction: its status, and its body when there is one. */
async function java(stId: string): Promise<{ status: number; body: JavaAnswer | undefined }> {
  const response = await fetch(`${JAVA}/ContentService/exporter/reaction/${stId}/diagram`, {
    signal: AbortSignal.timeout(120_000),
  });
  const text = await response.text();
  await new Promise((resolve) => setTimeout(resolve, 150));
  return {
    status: response.status,
    body: response.status === 200 ? (JSON.parse(text) as JavaAnswer) : undefined,
  };
}

/** The outcome of one reaction: the parts that differ, empty when none do. */
interface Outcome {
  parts: string[];
  /** Both sides failed: Java with its 500, node with one of the library's Java exceptions. */
  bothFailed?: boolean;
  /** The attempt Java's layout matched on, past the first. */
  attempt?: number;
  /** Where the diagrams first differed, on the last attempt. */
  where?: string;
}

const isJavaException = (error: unknown) =>
  error instanceof JavaNullPointerException || error instanceof JavaRuntimeException;

/**
 * Java's answer with its ids taken from its first: the same layout and orders
 * on two attempts give the same text, wherever each attempt's ids began.
 */
function fingerprint(summary: Summary, first: number): string {
  const relative = (text: string) =>
    JSON.stringify(
      JSON.parse(text, (_key, value: unknown) =>
        typeof value === 'number' && Number.isInteger(value) && value >= first
          ? value - first
          : value
      )
    );
  return `${summary.diagram}|${relative(summary.orders)}`;
}

/** Attempts after which, Java having answered the same each time, node's difference is node's. */
const STEADY = 4;

/** One reaction compared. */
async function compare(stId: string): Promise<Outcome> {
  const answers = new Set<string>();
  for (let attempt = 1; ; attempt += 1) {
    let answer: Awaited<ReturnType<typeof java>>;
    try {
      answer = await java(stId);
    } catch (error) {
      const name = (error as Error).name;
      return {
        parts: [
          name === 'SyntaxError'
            ? "java's answer unreadable (not JSON)"
            : `java request failed (${name})`,
        ],
      };
    }
    let first = 1;
    try {
      if (answer.body) first = answer.body.diagram.edges[0].id;
    } catch (error) {
      return { parts: [`java's answer unreadable (${(error as Error).name})`] };
    }
    let laid: { inputs: Inputs; diagram: JavaDiagram } | Error;
    try {
      const inputs = await readInputs(stId, first);
      laid = { inputs, diagram: nodeDiagram(inputs) };
    } catch (error) {
      laid = error as Error;
    }
    if (!answer.body) {
      if (answer.status === 500 && isJavaException(laid)) return { parts: [], bothFailed: true };
      return {
        parts: [
          laid instanceof Error
            ? `java ${answer.status}, node threw ${laid.name}`
            : `java ${answer.status}, node answered`,
        ],
      };
    }
    if (laid instanceof Error)
      return { parts: [`node threw ${laid.name}: ${laid.message.slice(0, 80)}`] };
    let javaSummary: Summary;
    try {
      javaSummary = summary(answer.body.diagram, answer.body.graph?.speciesName ?? null);
    } catch (error) {
      return { parts: [`java's answer unreadable (${(error as Error).name})`] };
    }
    const nodeSummary = summary(laid.diagram, laid.inputs.reaction.data.speciesName);
    answers.add(fingerprint(javaSummary, first));
    const parts = differences(javaSummary, nodeSummary);
    if (!parts.length) return attempt > 1 ? { parts, attempt } : { parts };
    const last: Outcome = parts.includes('diagram')
      ? {
          parts,
          where: whereDiffers(
            JSON.parse(javaSummary.diagram) as Json,
            JSON.parse(nodeSummary.diagram) as Json
          ),
        }
      : { parts };
    // Ids alone differing may be another request's ids in between: ask again.
    if (parts.length === 1 && parts[0] === 'ids' && attempt < 3) continue;
    // A layout or an order that differs may be one of Java's others -- which of
    // an entity's roles keeps the glyph and which goes to its copy follows the
    // roles' random order (D21): ask again, up to ATTEMPTS -- but once Java has
    // answered the same STEADY times, it is not varying, and the difference is
    // node's: no more requests on the shared database.
    const steady = attempt >= STEADY && answers.size === 1;
    if ((parts.includes('diagram') || parts.includes('orders')) && attempt < ATTEMPTS && !steady)
      continue;
    return last;
  }
}

async function main() {
  const asked = process.argv.slice(2);
  const ids = asked.some((arg) => arg.startsWith('R-'))
    ? asked
    : await reactions(Number(asked[0] ?? 200));
  console.log(`comparing ${ids.length} reactions, steps 1 to 3 (up to ${ATTEMPTS} attempts each)`);
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
