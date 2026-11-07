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
 * `/exporter/reaction/{identifier}.{ext}`, the reaction's image, is the
 * exporters family's, with the other figures (research D24).
 */
import type { Endpoint, Request } from './endpoint.ts';
import { pathId, rawSegment } from './spring.ts';
import { javaError, notFound } from './answers.ts';
import { findById, layoutFailureMessage } from './objects.ts';
import { reactionAnswer } from './reaction-layout/answer.ts';

/** The path variable's segment in `/ContentService/exporter/reaction/{id}/diagram`. */
const ID_SEGMENT = 4;

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
