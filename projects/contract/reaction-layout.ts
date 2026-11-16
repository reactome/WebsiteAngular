// A reaction's own layout (spec 016, T025f): /exporter/reaction/{id}/diagram,
// the diagram the service lays out for one reaction and the graph behind it.
// The service builds it (tools/content-node/reaction-layout/, spec 006 T092)
// and writes it as Java's diagram-reader classes are written: a null, empty
// text or an empty list is left out, 0 and false are written. So a field
// the layout can be without is optional here; one it always gives, or the
// graph always has, is required. (The service's own model holds some of
// these as nullable, as Java's readers do: measured over the recorded
// answers, they are always there.) The reaction figure on a reaction's page
// draws it.

/** A point. */
export interface LayoutCoordinate {
  x: number;
  y: number;
}

/** A straight line of a path. */
export interface LayoutSegment {
  from: LayoutCoordinate;
  to: LayoutCoordinate;
}

/** The shapes the layout draws. */
type LayoutShapeType = 'ARROW' | 'BOX' | 'CIRCLE' | 'DOUBLE_CIRCLE' | 'STOP';

/**
 * A shape: a box gives its corners a and b, a circle its centre c and
 * radius r, an arrow its three points, a double circle an inner radius r1.
 * `s` is a box's text.
 */
export interface LayoutShape {
  a?: LayoutCoordinate;
  b?: LayoutCoordinate;
  c?: LayoutCoordinate;
  r?: number;
  r1?: number;
  s?: string;
  type: LayoutShapeType;
  empty?: boolean;
}

/** How many of a participant a connector carries, and the box it is shown in when more than one. */
export interface LayoutStoichiometry {
  value: number;
  shape?: LayoutShape;
}

/** A box shape: its corners, and its text where it has one. */
interface LayoutBox extends LayoutShape {
  a: LayoutCoordinate;
  b: LayoutCoordinate;
  type: 'BOX';
  empty: boolean;
}

/** A box: its top left corner and its size. */
export interface LayoutProp {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** What every object drawn has: an id in the layout, what it draws, where and how far it reaches. */
interface LayoutObject {
  /** The object's id in this layout; ids run on from request to request. */
  id: number;
  displayName: string;
  renderableClass: string;
  /** The centre. */
  position: LayoutCoordinate;
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** The roles a connector draws. */
type LayoutConnectorType = 'INPUT' | 'OUTPUT' | 'CATALYST' | 'INHIBITOR' | 'ACTIVATOR';

/** A node's line to the reaction: one for each role the node takes. */
export interface LayoutConnector {
  /** The reaction's id in the layout. */
  edgeId: number;
  isDisease?: true;
  /** The role it draws. */
  type: LayoutConnectorType;
  segments: LayoutSegment[];
  endShape?: LayoutShape;
  stoichiometry: LayoutStoichiometry;
}

/** A modification drawn on a node's edge. */
export interface LayoutAttachment {
  label?: string;
  reactomeId: number;
  shape: LayoutBox;
}

/** A participant drawn: a physical entity, once for each place it is drawn. */
export interface LayoutNode extends LayoutObject {
  reactomeId: number;
  schemaClass: string;
  isDisease?: true;
  prop: LayoutProp;
  nodeAttachments?: LayoutAttachment[];
  connectors: LayoutConnector[];
  trivial?: true;
  needDashedBorder?: true;
}

/** A participant of the reaction, by its node's id. */
export interface LayoutPart {
  id: number;
  stoichiometry: number;
}

/** The reaction drawn. */
export interface LayoutEdge extends LayoutObject {
  reactomeId: number;
  schemaClass: string;
  isDisease: boolean;
  /** The reaction's line, through its shape. */
  segments: LayoutSegment[];
  reactionShape: LayoutShape;
  inputs?: LayoutPart[];
  outputs?: LayoutPart[];
  catalysts?: LayoutPart[];
  inhibitors?: LayoutPart[];
  activators?: LayoutPart[];
}

/**
 * A compartment drawn. One the layout adds to hold others, from the GO
 * tree, has no object in the graph, so no reactomeId or schemaClass.
 */
export interface LayoutCompartment extends LayoutObject {
  reactomeId?: number;
  schemaClass?: string;
  prop: LayoutProp;
  textPosition: LayoutCoordinate;
  /** The ids of the nodes and compartments inside it: a compartment is in the layout for what it holds. */
  componentIds: number[];
}

/** The reaction laid out. Its bounds are whole numbers. */
export interface ReactionLayoutDiagram {
  isDisease: boolean;
  displayName: string;
  nodes?: LayoutNode[];
  /** The reaction: one. */
  edges: LayoutEdge[];
  compartments?: LayoutCompartment[];
  dbId: number;
  /** The stable id of a pathway with a diagram the reaction is in; the text "null" where there is none. */
  stableId: string;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

/** A physical entity of the reaction, with the layout's ids drawing it. */
export interface LayoutEntityNode {
  parents?: number[];
  children?: number[];
  identifier?: string;
  /** A name the graph has as null is written null. */
  geneNames?: (string | null)[];
  diagramIds?: number[];
  dbId: number;
  stId: string;
  displayName: string;
  schemaClass: string;
  speciesID: number;
}

/** The reaction, with the dbIds of what takes part in it. */
export interface LayoutEventNode {
  preceding?: number[];
  following?: number[];
  inputs?: number[];
  outputs?: number[];
  catalysts?: number[];
  inhibitors?: number[];
  activators?: number[];
  requirements?: number[];
  diagramIds?: number[];
  dbId: number;
  stId: string;
  displayName: string;
  schemaClass: string;
  entityFunctionalStatus?: number[];
  speciesID: number;
}

/** The objects behind the layout. */
export interface ReactionLayoutGraph {
  dbId: number;
  stId: string;
  displayName: string;
  speciesName?: string;
  nodes?: LayoutEntityNode[];
  /** The reaction: one. */
  edges: LayoutEventNode[];
}

/** /exporter/reaction/{id}/diagram's answer. */
export interface ReactionLayout {
  diagram: ReactionLayoutDiagram;
  graph: ReactionLayoutGraph;
}
