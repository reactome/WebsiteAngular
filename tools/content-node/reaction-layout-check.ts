/**
 * The reaction layout comparison (spec 006 T092, research D22): node's
 * layout against Java's /exporter/reaction/{id}/diagram, on the parts the
 * steps built so far decide. Step 1 compares the inputs, as lists that do
 * not depend on Java's random order of a participant's roles:
 * - each node's identity, flags, attachments and compartment;
 * - each glyph id with what it is: node ids with their entity, compartment
 *   ids with their compartment, the edge's with the reaction -- node runs
 *   from the first id Java's answer shows (its edge's), so a glyph made out
 *   of Java's order shows here;
 * - each role, from the edge: entity, type and stoichiometry;
 * - each compartment's place in the tree, and the headers.
 *
 *   JAVA_CONTENT_SERVICE=http://localhost:8080 node tools/content-node/reaction-layout-check.ts [count]
 *
 * Reactions: `count` at random (default 200), every reaction with no
 * compartment, and some failed reactions, disease ones, and ones with drugs
 * among or inside their participants. An answer whose ids differ is asked
 * again (another request may have taken ids in between), up to three times.
 * A Java error must meet an error from node; its text is step 5's. Spaced for
 * the shared database; stops after 20 differences in a row. Prints reaction
 * ids and counts only. Exits 1 on any difference.
 */
import { close, read } from './graph.ts';
import {
  readInputs,
  removeExtracellular,
  reactionRenderableClass,
} from './reaction-layout/inputs.ts';
import type { Inputs } from './reaction-layout/inputs.ts';
import { JavaNullPointerException, JavaRuntimeException } from './reaction-layout/model.ts';
import type { CompartmentGlyph, EntityGlyph, EntityRole } from './reaction-layout/model.ts';

const JAVA = process.env['JAVA_CONTENT_SERVICE'] || 'http://localhost:8080';

/** The parts of a diagram node step 1 decides. */
interface NodePart {
  reactomeId: number;
  schemaClass: string;
  renderableClass: string;
  displayName: string;
  isDisease: boolean | null;
  needDashedBorder: boolean | null;
  trivial: boolean | null;
  attachments: [label: string | null, reactomeId: number][];
  compartment: string | null;
}

interface CompartmentPart {
  displayName: string;
  reactomeId: number | null;
  schemaClass: string | null;
  parent: string | null;
}

interface Summary {
  header: {
    displayName: string;
    dbId: number;
    isDisease: boolean;
    stableId: string | null;
    speciesName: string | null;
  };
  edge: { reactomeId: number; schemaClass: string; displayName: string };
  /**
   * The compartment holding the reaction: Java's, and node's with those
   * inside it -- placement (step 3) may move the reaction inward, never out.
   */
  reactionIn: (string | null)[];
  nodes: string[];
  compartments: string[];
  roles: string[];
  ids: string[];
}

/** The edge's lists, by the role type they hold. */
const ROLE_LISTS: [
  list: 'inputs' | 'outputs' | 'catalysts' | 'inhibitors' | 'activators',
  type: EntityRole,
][] = [
  ['inputs', 'input'],
  ['outputs', 'output'],
  ['catalysts', 'catalyst'],
  ['inhibitors', 'negative'],
  ['activators', 'positive'],
];

/** Java's answer, as far as step 1 reads it. Jackson leaves out what is null or empty. */
interface JavaPart {
  id: number;
  stoichiometry?: number;
}
interface JavaEdge {
  id: number;
  reactomeId: number;
  schemaClass: string;
  displayName: string;
  inputs?: JavaPart[];
  outputs?: JavaPart[];
  catalysts?: JavaPart[];
  inhibitors?: JavaPart[];
  activators?: JavaPart[];
}
interface JavaNode {
  id: number;
  reactomeId: number;
  schemaClass: string;
  renderableClass: string;
  displayName: string;
  isDisease?: boolean;
  needDashedBorder?: boolean;
  trivial?: boolean;
  nodeAttachments?: { label?: string; reactomeId: number }[];
}
interface JavaCompartment {
  id: number;
  reactomeId?: number;
  schemaClass?: string;
  displayName: string;
  componentIds?: number[];
}
interface JavaAnswer {
  diagram: {
    displayName: string;
    dbId: number;
    isDisease: boolean;
    stableId?: string;
    nodes?: JavaNode[];
    compartments?: JavaCompartment[];
    edges: [JavaEdge];
  };
  graph?: { speciesName?: string };
}

/** A list compared as a multiset: each item as JSON, sorted. */
const sorted = (items: unknown[]) => items.map((item) => JSON.stringify(item)).sort();

function javaSummary(answer: JavaAnswer): Summary {
  const diagram = answer.diagram;
  const nodes = diagram.nodes ?? [];
  const compartments = diagram.compartments ?? [];
  const holder = new Map<number, string>();
  const parentOf = new Map<number, string>();
  const compartmentIds = new Set<number>(compartments.map((c) => c.id));
  for (const compartment of compartments)
    for (const id of compartment.componentIds ?? []) {
      if (compartmentIds.has(id)) parentOf.set(id, compartment.displayName);
      else holder.set(id, compartment.displayName);
    }
  const [edge] = diagram.edges;
  // An entity by dbId and dashed: Java keeps a dashed and a plain participant
  // of one entity apart, and only DuplicateManager's copies are alike.
  const entityOf = new Map<number, [number, boolean]>(
    nodes.map((node) => [node.id, [node.reactomeId, node.needDashedBorder === true]])
  );
  return {
    header: {
      displayName: diagram.displayName,
      dbId: diagram.dbId,
      isDisease: diagram.isDisease,
      stableId: diagram.stableId ?? null,
      speciesName: answer.graph?.speciesName ?? null,
    },
    edge: {
      reactomeId: edge.reactomeId,
      schemaClass: edge.schemaClass,
      displayName: edge.displayName,
    },
    reactionIn: [holder.get(edge.id) ?? null],
    nodes: sorted(
      nodes.map((node): NodePart => ({
        reactomeId: node.reactomeId,
        schemaClass: node.schemaClass,
        renderableClass: node.renderableClass,
        displayName: node.displayName,
        isDisease: node.isDisease ?? null,
        needDashedBorder: node.needDashedBorder ?? null,
        trivial: node.trivial ?? null,
        attachments: (node.nodeAttachments ?? []).map((a) => [a.label ?? null, a.reactomeId]),
        compartment: holder.get(node.id) ?? null,
      }))
    ),
    compartments: sorted(
      compartments.map((c): CompartmentPart => ({
        displayName: c.displayName,
        reactomeId: c.reactomeId ?? null,
        schemaClass: c.schemaClass ?? null,
        parent: parentOf.get(c.id) ?? null,
      }))
    ),
    // Each glyph's roles, sorted: Java's order within a glyph is random, but
    // which roles share a glyph is not.
    roles: sorted(
      nodes.map((node) => [
        entityOf.get(node.id),
        ROLE_LISTS.flatMap(([list, type]) =>
          (edge[list] ?? [])
            .filter((part) => part.id === node.id)
            .map((part) => [type, part.stoichiometry ?? null])
        )
          .map((role) => JSON.stringify(role))
          .sort(),
      ])
    ),
    ids: sorted([
      ['reaction', edge.id, edge.reactomeId],
      ...nodes.map((node) => ['entity', node.id, node.reactomeId, node.needDashedBorder === true]),
      ...compartments.map((c) => ['compartment', c.id, c.displayName, c.reactomeId ?? null]),
    ]),
  };
}

function nodeSummary(inputs: Inputs): Summary {
  removeExtracellular(inputs);
  const present = new Set<CompartmentGlyph>(inputs.compartments.values());
  const shown = (glyph: CompartmentGlyph | undefined) =>
    glyph && present.has(glyph) ? glyph.name : null;
  const entities: EntityGlyph[] = [...inputs.entities];
  const reaction = inputs.reaction.data;
  // The edge's renderable class is always "Reaction"; its shape, which the
  // category decides, is step 3's. The category is read here so it is checked.
  reactionRenderableClass(reaction.category);
  return {
    header: {
      displayName: reaction.displayName,
      dbId: reaction.dbId,
      isDisease: reaction.isInDisease === true,
      stableId: inputs.pathway,
      speciesName: reaction.speciesName,
    },
    edge: {
      reactomeId: reaction.dbId,
      schemaClass: reaction.schemaClass,
      displayName: reaction.displayName,
    },
    reactionIn: within(inputs.reaction.compartment).map(shown),
    nodes: sorted(
      entities.map((entity): NodePart => ({
        reactomeId: entity.dbId,
        schemaClass: entity.schemaClass,
        renderableClass: entity.renderableClass,
        displayName: entity.name,
        isDisease: entity.disease ? true : null,
        needDashedBorder: entity.dashed ? true : null,
        trivial: entity.trivial ? true : null,
        attachments: entity.attachments.map((a) => [a.data.label, a.data.dbId]),
        compartment: shown(entity.compartment),
      }))
    ),
    compartments: sorted(
      [...present].map((glyph): CompartmentPart => ({
        displayName: glyph.name,
        reactomeId: glyph.dbId ?? null,
        schemaClass: glyph.schemaClass ?? null,
        parent: shown(glyph.parent),
      }))
    ),
    roles: sorted(
      entities.map((entity) => [
        [entity.dbId, entity.dashed],
        entity.roles.map((role) => JSON.stringify([role.type, role.n])).sort(),
      ])
    ),
    ids: sorted([
      ['reaction', inputs.reaction.id, reaction.dbId],
      ...entities.map((entity) => ['entity', entity.id, entity.dbId, entity.dashed]),
      ...[...present].map((glyph) => ['compartment', glyph.id, glyph.name, glyph.dbId ?? null]),
    ]),
  };
}

/** A compartment and every compartment inside it, depth first. */
function within(glyph: CompartmentGlyph | undefined): (CompartmentGlyph | undefined)[] {
  if (!glyph) return [undefined];
  return [glyph, ...[...glyph.children].flatMap((child) => within(child))];
}

const PARTS = ['header', 'edge', 'nodes', 'compartments', 'roles', 'ids'] as const;

/** Which parts of two summaries differ. */
function differences(java: Summary, node: Summary): string[] {
  const parts: string[] = PARTS.filter(
    (key) => JSON.stringify(java[key]) !== JSON.stringify(node[key])
  );
  if (!node.reactionIn.includes(java.reactionIn[0] ?? null)) parts.push('reaction compartment');
  return parts;
}

/** Whether Java's reaction sits where step 1 put it, rather than moved inward. */
function reactionStayed(java: Summary, node: Summary): boolean {
  return node.reactionIn[0] === (java.reactionIn[0] ?? null);
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
            WHERE NOT (pe)-[:compartment]->() RETURN DISTINCT r.stId AS stId LIMIT 10 }
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
  /** Placement moved Java's reaction inward from where step 1 put it. */
  movedInward?: boolean;
}

/** One reaction compared. */
async function compare(stId: string): Promise<Outcome> {
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
    let inputs: Inputs | Error;
    try {
      inputs = await readInputs(stId, first);
    } catch (error) {
      inputs = error as Error;
    }
    if (!answer.body) {
      if (
        answer.status === 500 &&
        (inputs instanceof JavaNullPointerException || inputs instanceof JavaRuntimeException)
      )
        return { parts: [], bothFailed: true };
      return {
        parts: [
          inputs instanceof Error
            ? `java ${answer.status}, node threw ${inputs.name}`
            : `java ${answer.status}, node answered`,
        ],
      };
    }
    if (inputs instanceof Error)
      return { parts: [`node threw ${inputs.name}: ${inputs.message.slice(0, 80)}`] };
    let java_: Summary;
    try {
      java_ = javaSummary(answer.body);
    } catch (error) {
      return { parts: [`java's answer unreadable (${(error as Error).name})`] };
    }
    let parts: string[];
    let node_: Summary;
    try {
      node_ = nodeSummary(inputs);
      parts = differences(java_, node_);
    } catch (error) {
      return {
        parts: [`node threw ${(error as Error).name}: ${(error as Error).message.slice(0, 80)}`],
      };
    }
    // Ids alone differing may be another request's ids in between: ask again.
    if (parts.length === 1 && parts[0] === 'ids' && attempt < 3) continue;
    return { parts, movedInward: !parts.length && !reactionStayed(java_, node_) };
  }
}

async function main() {
  const ids = await reactions(Number(process.argv[2] ?? 200));
  console.log(`comparing ${ids.length} reactions, step 1`);
  let identical = 0;
  let bothFailed = 0;
  let movedInward = 0;
  let different = 0;
  let inARow = 0;
  for (const stId of ids) {
    const { parts, bothFailed: failed, movedInward: moved } = await compare(stId);
    if (!parts.length) {
      if (failed) bothFailed += 1;
      else identical += 1;
      if (moved) {
        // Placement's to explain, at step 3: listed so that many can be looked at.
        movedInward += 1;
        console.log(`  ${stId}: the reaction moved inward`);
      }
      inARow = 0;
      continue;
    }
    different += 1;
    inARow += 1;
    console.log(`  ${stId}: ${parts.join(', ')} differ`);
    if (inARow >= 20) {
      console.log('stopped: 20 differences in a row');
      break;
    }
  }
  await close();
  console.log(
    `compared: ${identical} identical (${movedInward} with the reaction moved inward by placement), ` +
      `${bothFailed} failing on both sides (texts are step 5's), ${different} different`
  );
  process.exit(different ? 1 : 0);
}

await main();
