/**
 * reaction-exporter's Transformer, as the BOX algorithm uses it (research
 * D22, step 3): moving and centring a glyph with everything drawn with it,
 * the bounds a glyph takes up, and a glyph's size (sizes.ts), set when a
 * layout takes the glyph in.
 */
import { Bounds } from './bounds.ts';
import { add } from './shapes.ts';
import type { Coordinate, Shape } from './shapes.ts';
import { setEntitySize, setReactionSize } from './sizes.ts';
import type { CompartmentGlyph, EntityGlyph, ReactionGlyph } from './model.ts';

const BACKBONE_LENGTH = 20;
const ATTACHMENT_SIZE = 12;

/** A glyph placed by a layout: an entity or the reaction. */
export type PlacedGlyph = EntityGlyph | ReactionGlyph;

/** move(glyph, delta): the glyph, and what moves with it. */
export function move(glyph: PlacedGlyph, delta: Coordinate) {
  glyph.bounds.move(delta.x, delta.y);
  if (glyph.kind === 'reaction') {
    for (const segment of glyph.segments) {
      segment.from = add(segment.from, delta);
      segment.to = add(segment.to, delta);
    }
    return;
  }
  for (const attachment of glyph.attachments) attachment.bounds.move(delta.x, delta.y);
  for (const connector of glyph.connectors) {
    for (const segment of connector.segments) {
      segment.from = add(segment.from, delta);
      segment.to = add(segment.to, delta);
    }
    moveShape(connector.endShape, delta);
    moveShape(connector.stoichiometry?.shape, delta);
  }
}

function moveShape(shape: Shape | undefined, delta: Coordinate) {
  if (!shape) return;
  if (shape.a) shape.a = add(shape.a, delta);
  if (shape.b) shape.b = add(shape.b, delta);
  if (shape.c) shape.c = add(shape.c, delta);
}

/** move(compartment, delta, moveContent): its box and label, and with `content` all inside it. */
export function moveCompartment(
  compartment: CompartmentGlyph,
  delta: Coordinate,
  content: boolean
) {
  compartment.bounds.move(delta.x, delta.y);
  if (compartment.labelPosition) compartment.labelPosition = add(compartment.labelPosition, delta);
  if (!content) return;
  for (const glyph of compartment.contained) move(glyph, delta);
  for (const child of compartment.children) moveCompartment(child, delta, true);
}

/** center(glyph, centre): moved by the difference from its own centre. */
export function center(glyph: PlacedGlyph, centre: Coordinate) {
  move(glyph, { x: centre.x - glyph.bounds.cx, y: centre.y - glyph.bounds.cy });
}

/**
 * getBounds: a copy of the glyph's box, an entity's grown by half an
 * attachment all round when it has any, the reaction's by its backbone.
 */
export function boundsOf(glyph: PlacedGlyph): Bounds {
  const bounds = glyph.bounds.copy();
  if (glyph.kind === 'reaction') {
    bounds.setWidth(bounds.width + 2 * BACKBONE_LENGTH);
    bounds.move(-BACKBONE_LENGTH, 0);
    return bounds;
  }
  if (!glyph.attachments.length) return bounds;
  bounds.setWidth(bounds.width + ATTACHMENT_SIZE);
  bounds.setHeight(bounds.height + ATTACHMENT_SIZE);
  bounds.move(-0.5 * ATTACHMENT_SIZE, -0.5 * ATTACHMENT_SIZE);
  return bounds;
}

/** padd(bounds, horizontal, vertical). */
export function padded(bounds: Bounds, horizontal: number, vertical: number): Bounds {
  return Bounds.of(
    bounds.x - horizontal,
    bounds.y - vertical,
    bounds.width + 2 * horizontal,
    bounds.height + 2 * vertical
  );
}

/** setSize(glyph): an entity's size, or the reaction's with its backbone appended. */
export function setSize(glyph: PlacedGlyph) {
  if (glyph.kind === 'entity') setEntitySize(glyph);
  else setReactionSize(glyph);
}
