/**
 * The reaction layout comparison (spec 006 T092, research D22): node's
 * layout against Java's /exporter/reaction/{id}/diagram, on the parts the
 * steps built so far decide. Step 1 compares the inputs: each node's
 * identity, flags, attachments and compartment, each compartment's place in
 * the tree, and the diagram's header -- as sorted lists, nothing being
 * placed yet.
 *
 *   JAVA_CONTENT_SERVICE=http://localhost:8080 node tools/content-node/reaction-layout-check.ts [count]
 *
 * Reactions: `count` at random (default 200), every reaction with no
 * compartment, and a few failed reactions, drug and disease ones. Node runs
 * in process, from the first glyph id Java's answer shows (its edge's id).
 * Spaced for the shared database; stops after 20 differences in a row.
 * Prints reaction ids and counts only. Exits 1 on any difference.
 */
import { close, read } from './graph.ts';
import {
  readInputs,
  removeExtracellular,
  reactionRenderableClass,
} from './reaction-layout/inputs.ts';
import type { Inputs } from './reaction-layout/inputs.ts';
import type { CompartmentGlyph, EntityGlyph } from './reaction-layout/model.ts';

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
  header: { displayName: string; dbId: number; isDisease: boolean; stableId: string | null };
  edge: { reactomeId: number; schemaClass: string; displayName: string };
  nodes: string[];
  compartments: string[];
}

/** A list compared as a multiset: each item as JSON, sorted. */
const sorted = (items: unknown[]) => items.map((item) => JSON.stringify(item)).sort();

/* eslint-disable @typescript-eslint/no-explicit-any -- Java's answer, read as it comes */
function javaSummary(answer: any): Summary {
  const diagram = answer.diagram;
  const holder = new Map<number, string>();
  const parentOf = new Map<number, string>();
  const compartmentIds = new Set<number>((diagram.compartments ?? []).map((c: any) => c.id));
  for (const compartment of diagram.compartments ?? [])
    for (const id of compartment.componentIds ?? []) {
      if (compartmentIds.has(id)) parentOf.set(id, compartment.displayName);
      else holder.set(id, compartment.displayName);
    }
  const nodes: NodePart[] = (diagram.nodes ?? []).map((node: any) => ({
    reactomeId: node.reactomeId,
    schemaClass: node.schemaClass,
    renderableClass: node.renderableClass,
    displayName: node.displayName,
    isDisease: node.isDisease ?? null,
    needDashedBorder: node.needDashedBorder ?? null,
    trivial: node.trivial ?? null,
    attachments: (node.nodeAttachments ?? []).map((a: any) => [a.label ?? null, a.reactomeId]),
    compartment: holder.get(node.id) ?? null,
  }));
  const compartments: CompartmentPart[] = (diagram.compartments ?? []).map((c: any) => ({
    displayName: c.displayName,
    reactomeId: c.reactomeId ?? null,
    schemaClass: c.schemaClass ?? null,
    parent: parentOf.get(c.id) ?? null,
  }));
  const [edge] = diagram.edges;
  return {
    header: {
      displayName: diagram.displayName,
      dbId: diagram.dbId,
      isDisease: diagram.isDisease,
      stableId: diagram.stableId ?? null,
    },
    edge: {
      reactomeId: edge.reactomeId,
      schemaClass: edge.schemaClass,
      displayName: edge.displayName,
    },
    nodes: sorted(nodes),
    compartments: sorted(compartments),
  };
}
/* eslint-enable @typescript-eslint/no-explicit-any */

function nodeSummary(inputs: Inputs): Summary {
  removeExtracellular(inputs);
  const present = new Set<CompartmentGlyph>(inputs.compartments.values());
  const shown = (glyph: CompartmentGlyph | undefined) =>
    glyph && present.has(glyph) ? glyph.name : null;
  const nodes: NodePart[] = [...inputs.entities].map((entity: EntityGlyph) => ({
    reactomeId: entity.dbId,
    schemaClass: entity.schemaClass,
    renderableClass: entity.renderableClass,
    displayName: entity.name,
    isDisease: entity.disease ? true : null,
    needDashedBorder: entity.dashed ? true : null,
    trivial: entity.trivial ? true : null,
    attachments: entity.attachments.map((a) => [a.data.label, a.data.dbId]),
    compartment: shown(entity.compartment),
  }));
  const compartments: CompartmentPart[] = [...present].map((glyph) => ({
    displayName: glyph.name,
    reactomeId: glyph.dbId ?? null,
    schemaClass: glyph.schemaClass ?? null,
    parent: shown(glyph.parent),
  }));
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
    },
    edge: {
      reactomeId: reaction.dbId,
      schemaClass: reaction.schemaClass,
      displayName: reaction.displayName,
    },
    nodes: sorted(nodes),
    compartments: sorted(compartments),
  };
}

/** Which parts of two summaries differ. */
function differences(java: Summary, node: Summary): string[] {
  const parts: string[] = [];
  for (const key of ['header', 'edge', 'nodes', 'compartments'] as const)
    if (JSON.stringify(java[key]) !== JSON.stringify(node[key])) parts.push(key);
  return parts;
}

async function reactions(count: number): Promise<string[]> {
  const rows = await read<{ stId: string }>(
    `CALL { MATCH (r:ReactionLikeEvent) WHERE r.stId IS NOT NULL
            RETURN r.stId AS stId ORDER BY rand() LIMIT toInteger($count)
      UNION MATCH (r:ReactionLikeEvent) WHERE NOT (r)-[:compartment]->() RETURN r.stId AS stId
      UNION MATCH (r:FailedReaction) RETURN r.stId AS stId LIMIT 10
      UNION MATCH (r:ReactionLikeEvent {isInDisease: true}) RETURN r.stId AS stId LIMIT 10
      UNION MATCH (r:ReactionLikeEvent)-[:input|output]->(:Drug) RETURN DISTINCT r.stId AS stId LIMIT 10
      UNION MATCH (r:ReactionLikeEvent)-[:input|output]->(pe)
            WHERE NOT (pe)-[:compartment]->() RETURN DISTINCT r.stId AS stId LIMIT 10 }
     RETURN DISTINCT stId`,
    { count: Math.trunc(count) }
  );
  return rows.map((row) => row.stId);
}

async function main() {
  const ids = await reactions(Number(process.argv[2] ?? 200));
  console.log(`comparing ${ids.length} reactions, step 1`);
  let identical = 0;
  let different = 0;
  let inARow = 0;
  const failures: Record<string, number> = {};
  for (const stId of ids) {
    const response = await fetch(`${JAVA}/ContentService/exporter/reaction/${stId}/diagram`, {
      signal: AbortSignal.timeout(120_000),
    });
    await new Promise((resolve) => setTimeout(resolve, 150));
    if (response.status !== 200) {
      // Java's errors are compared at step 5; noted here.
      failures[`java ${response.status}`] = (failures[`java ${response.status}`] ?? 0) + 1;
      await response.text();
      continue;
    }
    const answer = await response.json();
    const first = answer.diagram.edges[0].id as number;
    let parts: string[];
    try {
      parts = differences(javaSummary(answer), nodeSummary(await readInputs(stId, first)));
    } catch (error) {
      parts = [`threw ${(error as Error).name}: ${(error as Error).message.slice(0, 80)}`];
    }
    if (!parts.length) {
      identical += 1;
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
  for (const [what, n] of Object.entries(failures)) console.log(`  ${n} answered ${what} by Java`);
  console.log(`compared: ${identical} identical, ${different} different`);
  process.exit(different ? 1 : 0);
}

await main();
