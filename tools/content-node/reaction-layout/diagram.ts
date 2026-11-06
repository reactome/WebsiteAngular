/**
 * reaction-exporter's ReactionDiagramFactory (research D22, step 3): the
 * diagram part of the answer, from the laid-out glyphs -- its nodes with
 * their connectors and attachments, the reaction's edge with its parts by
 * role, the compartments with what each holds, and the limits. Lists and
 * parts come in the orders Java's hash sets give.
 *
 * Values and nulls are Java's; that Jackson leaves out null and empty
 * fields, and the order it writes them in, are step 4's.
 */
import type { Laid } from './algorithm.ts';
import type { Bounds } from './bounds.ts';
import { reactionRenderableClass } from './inputs.ts';
import type { CompartmentGlyph, EntityGlyph, ReactionGlyph } from './model.ts';
import { box } from './shapes.ts';
import type { Coordinate, Shape, Stoichiometry } from './shapes.ts';
import type { Segment } from './sizes.ts';

/** The (14, 18) every compartment's label is moved by (GWU_CORRECTION). */
const LABEL_CORRECTION = { x: 14, y: 18 };

interface Prop {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** What copyGlyphToDatabaseObject writes for any glyph. */
interface DiagramObject {
  id: number;
  reactomeId: number | null;
  displayName: string;
  schemaClass: string | null;
  renderableClass: string;
  position: Coordinate;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

interface DiagramConnector {
  edgeId: number;
  type: string | null;
  segments: Segment[];
  endShape: Shape | null;
  stoichiometry: Stoichiometry | null;
  isDisease: true | null;
}

interface DiagramNode extends DiagramObject {
  isDisease: true | null;
  trivial: true | null;
  needDashedBorder: true | null;
  prop: Prop;
  connectors: DiagramConnector[];
  nodeAttachments: { label: string | null; reactomeId: number; shape: Shape }[];
}

interface ReactionPart {
  id: number;
  stoichiometry: number;
}

interface DiagramEdge extends DiagramObject {
  isDisease: boolean;
  segments: Segment[];
  reactionShape: Shape;
  inputs: ReactionPart[];
  outputs: ReactionPart[];
  catalysts: ReactionPart[];
  inhibitors: ReactionPart[];
  activators: ReactionPart[];
}

interface DiagramCompartment extends DiagramObject {
  prop: Prop;
  textPosition: Coordinate;
  componentIds: number[];
}

export interface ReactionDiagram {
  isDisease: boolean;
  displayName: string;
  nodes: DiagramNode[];
  edges: [DiagramEdge];
  compartments: DiagramCompartment[];
  dbId: number;
  stableId: string;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

/** (int): toward zero. */
const int = (value: number) => Math.trunc(value);

const prop = (bounds: Bounds): Prop => ({
  x: bounds.x,
  y: bounds.y,
  width: bounds.width,
  height: bounds.height,
});

function object(
  glyph: { id: number; bounds: Bounds },
  fields: Pick<DiagramObject, 'reactomeId' | 'displayName' | 'schemaClass' | 'renderableClass'>
): DiagramObject {
  const bounds = glyph.bounds;
  return {
    id: glyph.id,
    ...fields,
    position: { x: bounds.cx, y: bounds.cy },
    minX: bounds.x,
    minY: bounds.y,
    maxX: bounds.mx,
    maxY: bounds.my,
  };
}

/** ReactionDiagramFactory.get. */
export function reactionDiagram(layout: Laid): ReactionDiagram {
  const reaction = layout.reaction;
  const disease = reaction.data.isInDisease === true;
  return {
    isDisease: disease,
    displayName: reaction.data.displayName,
    nodes: [...layout.entities].map((entity) => node(entity, reaction, disease)),
    edges: [edge(layout)],
    compartments: [...layout.compartments.values()].map(compartment),
    dbId: reaction.data.dbId,
    stableId: layout.pathway,
    minX: int(layout.bounds.x),
    maxX: int(layout.bounds.mx),
    minY: int(layout.bounds.y),
    maxY: int(layout.bounds.my),
  };
}

function compartment(glyph: CompartmentGlyph): DiagramCompartment {
  const label = glyph.labelPosition as Coordinate;
  return {
    ...object(glyph, {
      reactomeId: glyph.dbId ?? null,
      displayName: glyph.name,
      schemaClass: glyph.schemaClass ?? null,
      renderableClass: 'Compartment',
    }),
    prop: prop(glyph.bounds),
    textPosition: { x: label.x - LABEL_CORRECTION.x, y: label.y - LABEL_CORRECTION.y },
    componentIds: [
      ...[...glyph.contained].map((inner) => inner.id),
      ...[...glyph.children].map((child) => child.id),
    ],
  };
}

function edge({ reaction, entities }: Laid): DiagramEdge {
  const parts: Record<'input' | 'output' | 'catalyst' | 'negative' | 'positive', ReactionPart[]> = {
    input: [],
    output: [],
    catalyst: [],
    negative: [],
    positive: [],
  };
  // Crossed participants are left out: LayoutFactory never sets the flag (D22).
  for (const entity of entities)
    for (const role of entity.roles)
      parts[role.type].push({ id: entity.id, stoichiometry: role.n });
  return {
    ...object(reaction, {
      reactomeId: reaction.data.dbId,
      displayName: reaction.data.displayName,
      schemaClass: reaction.data.schemaClass,
      renderableClass: 'Reaction',
    }),
    isDisease: reaction.data.isInDisease === true,
    segments: reaction.segments,
    reactionShape: reactionShape(reaction),
    inputs: parts.input,
    outputs: parts.output,
    catalysts: parts.catalyst,
    inhibitors: parts.negative,
    activators: parts.positive,
  };
}

/** getReactionShape: by the reaction's category. */
function reactionShape(reaction: ReactionGlyph): Shape {
  const bounds = reaction.bounds;
  const centre = { x: bounds.cx, y: bounds.cy };
  const a = { x: bounds.x, y: bounds.y };
  const b = { x: bounds.mx, y: bounds.my };
  switch (reactionRenderableClass(reaction.data.category)) {
    case 'Dissociation':
      return { c: centre, r: 6, r1: 4, type: 'DOUBLE_CIRCLE', empty: true };
    case 'Omitted':
      return box(a, b, true, '\\\\');
    case 'Uncertain':
      return box(a, b, true, '?');
    case 'Binding':
      return { c: centre, r: 6, type: 'CIRCLE' };
    default:
      return box(a, b, true, null);
  }
}

function node(entity: EntityGlyph, reaction: ReactionGlyph, disease: boolean): DiagramNode {
  return {
    ...object(entity, {
      reactomeId: entity.dbId,
      displayName: entity.name,
      schemaClass: entity.schemaClass,
      renderableClass: entity.renderableClass,
    }),
    trivial: entity.trivial ? true : null,
    isDisease: entity.disease ? true : null,
    needDashedBorder: entity.dashed ? true : null,
    prop: prop(entity.bounds),
    connectors: entity.connectors.map((connector) => ({
      edgeId: reaction.id,
      type: connector.type ?? null,
      segments: connector.segments,
      endShape: connector.endShape ?? null,
      stoichiometry: connector.stoichiometry ?? null,
      isDisease: disease ? true : null,
    })),
    nodeAttachments: entity.attachments.map((attachment) => ({
      label: attachment.data.label,
      reactomeId: attachment.data.dbId,
      shape: box(
        { x: attachment.bounds.x, y: attachment.bounds.y },
        { x: attachment.bounds.mx, y: attachment.bounds.my },
        true,
        attachment.data.label
      ),
    })),
  };
}
