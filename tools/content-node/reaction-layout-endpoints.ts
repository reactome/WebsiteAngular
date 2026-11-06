/**
 * The reaction layout endpoint (spec 006 T092, research D22 step 5, a
 * family): `/exporter/reaction/{identifier}/diagram`, a reaction's layout as
 * diagram and graph JSON, as ImageExporterController.reactionJson answers it,
 * made by the reaction-layout library (tools/content-node/reaction-layout/).
 *
 * Java's answer is not the same twice (research D21): its glyph ids, some
 * orders and now and then the layout follow the requests before it. Node's is
 * deterministic, laid out from glyph id 1 as a freshly started service lays
 * out its first request (D22), so the same reaction gets the same bytes until
 * the graph changes. reaction-layout-check.ts compares it with Java's.
 *
 * `/exporter/reaction/{identifier}.{ext}`, the reaction's image, is not here:
 * it follows what T090 and T091 decide for diagrams' images.
 */
import type { Endpoint, Request } from './endpoint.ts';
import { javaSplit, javaTrim } from './java-text.ts';
import { read } from './graph.ts';
import { pathId, rawSegment } from './spring.ts';
import { javaError, notFound } from './answers.ts';
import { longPastRange, resolveId } from './objects.ts';
import { reactionAnswer } from './reaction-layout/answer.ts';
import { JavaNullPointerException, JavaRuntimeException } from './reaction-layout/model.ts';

/** The path variable's segment in `/ContentService/exporter/reaction/{id}/diagram`. */
const ID_SEGMENT = 4;

/**
 * What graph-core's findById makes of an id, as getReactionLikeEvent reads
 * it: a failure Java answers with its 500 (the message), or the object's
 * stable id and whether it is a ReactionLikeEvent, or undefined when there
 * is no object (Java's null). Its id rules are resolveId's: trimmed, a
 * version cut, a pre-2016 REACT_ id found by the stable id it became.
 */
async function findById(
  id: string
): Promise<{ failure: string } | { stId: string; reaction: boolean } | undefined> {
  // trimId splits an id without ':' at '.', and Java's split of dots alone
  // is empty: indexing it is the 500. Then findById's Long.parseLong
  // refuses a dbId past a long. Both measured against Java.
  const trimmed = javaTrim(id);
  if (!trimmed.includes(':') && trimmed !== '' && javaSplit(trimmed, '.').length === 0)
    return { failure: 'Index 0 out of bounds for length 0' };
  const pastLong = longPastRange([id]);
  if (pastLong) return { failure: pastLong };
  const { where, params } = resolveId(id);
  if (where === 'false') return undefined;
  const [row] = await read<{ labels: string[]; stId: string }>(
    `MATCH (n:DatabaseObject) WHERE ${where} RETURN labels(n) AS labels, n.stId AS stId LIMIT 1`,
    params
  );
  if (!row) return undefined;
  return { stId: row.stId, reaction: row.labels.includes('ReactionLikeEvent') };
}

/**
 * The service's answer to one of the library's Java exceptions (research
 * D22 step 5): GlobalExceptionHandler's 500, a NullPointerException with its
 * fixed text, any other exception with its message, null written as null.
 * Undefined for anything else, which is this service's own failure.
 */
export function layoutFailureMessage(failure: unknown): { message: string | null } | undefined {
  if (failure instanceof JavaNullPointerException)
    return { message: 'Something unexpected happened and the error has been reported.' };
  if (failure instanceof JavaRuntimeException) return { message: failure.javaMessage };
  return undefined;
}

/** ImageExporterController.reactionJson: the reaction's layout, or Java's error for the id. */
async function reactionLayout(request: Request) {
  const id = pathId(rawSegment(request, ID_SEGMENT));
  const found = await findById(id);
  if (found && 'failure' in found)
    return javaError(request, 500, 'INTERNAL_SERVER_ERROR', found.failure);
  if (!found) return notFound(request, `Identifier '${id}' not found`);
  // The cast to ReactionLikeEvent: a ClassCastException, which the
  // controller turns into a DiagramExporterException, Java's 400.
  if (!found.reaction)
    return javaError(
      request,
      400,
      'BAD_REQUEST',
      `The identifier '${id}' does not correspond to a 'ReactionLikeEvent'`
    );
  try {
    return (await reactionAnswer(found.stId)).answer;
  } catch (failure) {
    const java = layoutFailureMessage(failure);
    if (!java) throw failure;
    return javaError(request, 500, 'INTERNAL_SERVER_ERROR', java.message);
  }
}

export const reactionLayoutEndpoints: Endpoint[] = [
  {
    path: '/ContentService/exporter/reaction/{id}/diagram',
    // The error path, a pathway: Java's answer to the same reaction is not the
    // same twice (research D21), so the harness, which compares text as data,
    // cannot compare a layout. reaction-layout-check.ts compares the layouts
    // in canonical form, with the declared differences of D21 and D22. Never
    // expanded over --ids, for the same reason.
    sample: 'R-HSA-109581',
    samplesOnly: true,
    differs: [/^\/ContentService\/exporter\/reaction\/[^/]+\/diagram: \.url: /],
    handler: reactionLayout,
  },
];
