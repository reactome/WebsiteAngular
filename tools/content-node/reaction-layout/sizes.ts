/**
 * Step 2 of the reaction layout (research D22): each glyph's size, as
 * reaction-exporter's Transformer.setSize gives it -- an entity from its
 * fitted name and class, a protein's attachments around its edge (growing it
 * when they do not fit), and the reaction's box with its two backbone
 * segments.
 */
import { RATIO, textDimension } from './text.ts';
import type { EntityGlyph, ReactionGlyph } from './model.ts';

const BACKBONE_LENGTH = 20;
const REACTION_SIZE = 12;
const ATTACHMENT_SIZE = REACTION_SIZE;
const ATTACHMENT_PADDING = 2;
const BOX_SIZE = ATTACHMENT_SIZE + 2 * ATTACHMENT_PADDING;
const NODE_CORNER_RADIUS = 8;

/** A segment from one point to another, as the diagram writes it. */
export interface Segment {
  from: { x: number; y: number };
  to: { x: number; y: number };
}

/** setSize(ReactionGlyph): a 12 by 12 box and a backbone segment out of each side. */
export function setReactionSize(reaction: ReactionGlyph) {
  const bounds = reaction.bounds;
  bounds.setHeight(REACTION_SIZE);
  bounds.setWidth(REACTION_SIZE);
  reaction.segments.push(
    { from: { x: bounds.x, y: bounds.cy }, to: { x: bounds.x - BACKBONE_LENGTH, y: bounds.cy } },
    { from: { x: bounds.mx, y: bounds.cy }, to: { x: bounds.mx + BACKBONE_LENGTH, y: bounds.cy } }
  );
}

/** setSize(EntityGlyph): the name's box plus the class's margins. */
export function setEntitySize(entity: EntityGlyph) {
  const text = textDimension(entity.name);
  const bounds = entity.bounds;
  switch (entity.renderableClass) {
    case 'Chemical':
    case 'ChemicalDrug':
    case 'Complex':
    case 'ComplexDrug':
    case 'Entity':
    case 'ProteinDrug':
    case 'RNA':
    case 'RNADrug':
      bounds.setWidth(20 + text.width);
      bounds.setHeight(20 + text.height);
      break;
    case 'Protein':
      bounds.setWidth(20 + text.width);
      bounds.setHeight(20 + text.height);
      layoutAttachments(entity);
      break;
    case 'EncapsulatedNode':
    case 'ProcessNode':
    case 'EntitySet':
    case 'EntitySetDrug':
      bounds.setWidth(15 + text.width);
      bounds.setHeight(15 + text.height);
      break;
    case 'Gene':
      bounds.setWidth(6 + text.width);
      bounds.setHeight(30 + text.height);
      break;
    case 'Cell': {
      // Square rendering.
      const side = 30 + text.width;
      bounds.setWidth(side);
      bounds.setHeight(side);
      break;
    }
  }
}

/**
 * layoutAttachments: the protein moved to the origin, enlarged until its
 * edge holds a box per attachment, and the attachments centred on its edge
 * -- along the top, down the right, back along the bottom, up the left.
 */
function layoutAttachments(entity: EntityGlyph) {
  const bounds = entity.bounds;
  bounds.setX(0);
  bounds.setY(0);
  // The first pass subtracts 2 * 8 written out; later ones the corner radius, also 8.
  let width = bounds.width - 2 * 8;
  let height = bounds.height - 2 * 8;
  let boxesInWidth = Math.trunc(width / BOX_SIZE);
  let boxesInHeight = Math.trunc(height / BOX_SIZE);
  let maxBoxes = 2 * (boxesInHeight + boxesInWidth);
  while (entity.attachments.length > maxBoxes) {
    bounds.setWidth(bounds.width + BOX_SIZE);
    bounds.setHeight(bounds.width / RATIO);
    width = bounds.width - 2 * NODE_CORNER_RADIUS;
    height = bounds.height - 2 * NODE_CORNER_RADIUS;
    boxesInWidth = Math.trunc(width / BOX_SIZE);
    boxesInHeight = Math.trunc(height / BOX_SIZE);
    maxBoxes = 2 * (boxesInHeight + boxesInWidth);
  }
  const maxWidth = boxesInWidth * BOX_SIZE;
  const maxHeight = boxesInHeight * BOX_SIZE;
  const xOffset = NODE_CORNER_RADIUS + 0.5 * (BOX_SIZE + width - maxWidth);
  const yOffset = NODE_CORNER_RADIUS + 0.5 * (BOX_SIZE + height - maxHeight);
  entity.attachments.forEach((attachment, i) => {
    const box = attachment.bounds;
    box.setWidth(ATTACHMENT_SIZE);
    box.setHeight(ATTACHMENT_SIZE);
    if (i < boxesInWidth) box.setCenter(bounds.x + xOffset + i * BOX_SIZE, bounds.y);
    else if (i < boxesInWidth + boxesInHeight) {
      const pos = i - boxesInWidth;
      box.setCenter(bounds.mx, bounds.y + yOffset + pos * BOX_SIZE);
    } else if (i < 2 * boxesInWidth + boxesInHeight) {
      const pos = i - boxesInWidth - boxesInHeight;
      box.setCenter(bounds.mx - xOffset - pos * BOX_SIZE, bounds.my);
    } else {
      const pos = i - boxesInHeight - 2 * boxesInWidth;
      box.setCenter(bounds.x, bounds.my - yOffset - pos * BOX_SIZE);
    }
  });
}
