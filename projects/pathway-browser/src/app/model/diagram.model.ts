export interface Position {
  x: number;
  y: number;
}

export interface Prop extends Position {
  width: number;
  height: number;
}

export type Rectangle = { left: number; right: number; top: number; bottom: number };

export type Segment = { from: Position; to: Position };

/**
 * A diagram's layout .json, typed as the files are written: a field the
 * exporter has nothing for is left out. Measured over 42 diagrams of release
 * 97 and 75 of the exporter's reaction layouts, which use the same types but
 * write some shapes differently (#344).
 */
export interface Diagram {
  displayName: string;
  edges: Edge[];
  nodes: Node[];
  compartments: Compartment[];
  links: Link[];
  /**
   * The list of contained shadows(subpathways)
   */
  shadows: SubPathway[];
  /** Only on a disease diagram (16 of 42): false, drawn over its normal one. */
  forNormalDraw?: boolean;
  dbId: number;
  stableId: string;
}

/**
 * Box shapes give a and b, circles c and r; a diagram file adds a centre, the
 * exporter's reaction layouts do not.
 */
export interface ReactionShape {
  a?: Position;
  b?: Position;
  c?: Position;
  r?: number;
  centre?: Position;
  type: string;
}

export interface ConnectorHolder {
  [k: string]: EdgeConnector[] | undefined;

  /** Left out by the exporter for a black box event without inputs. */
  inputs?: EdgeConnector[];
  outputs?: EdgeConnector[];
  catalysts?: EdgeConnector[];
  inhibitors?: EdgeConnector[];
  activators?: EdgeConnector[];
}

export type Entity = {
  id: number;
  reactomeId: number;
  displayName: string;
  position: Position;
  renderableClass: string;
  schemaClass: string;
  isDisease?: boolean;
  isFadeOut?: boolean;
  isCrossed?: boolean;
  // Added by service
  rect?: Rectangle;
  isBackground?: boolean;
};

// reactions
export type Edge = {
  reactionShape: ReactionShape;
  reactionType?: string;
  segments: Segment[];
} & ConnectorHolder &
  Entity;

export interface EdgeConnector {
  id: number;
  points?: Position[];
  stoichiometry?: number;
  isFadeOut?: boolean;
}

export interface NodeConnector {
  edgeId: number;
  type: 'INPUT' | 'OUTPUT' | 'CATALYST' | 'ACTIVATOR' | 'INHIBITOR';
  segments: Segment[];
  stoichiometry: { value: number };
  /** `centre` in a diagram file, `c` in the exporter's reaction layouts. */
  endShape?: { centre?: Position; c?: Position };
  isFadeOut?: boolean;
}

// entities
export interface Node extends Entity {
  prop: Prop;
  connectors: NodeConnector[];
  interactorsSummary?: InteractorsSummary;
  nodeAttachments?: Attachment[];
  needDashedBorder?: boolean;
  trivial?: boolean;
}

export interface Compartment extends Entity {
  componentIds: number[];
  prop: Prop;
  insets?: Prop;
  textPosition: Position;
}

export interface Link {
  id: number;
  inputs: EdgeConnector[];
  outputs: EdgeConnector[];
  renderableClass: string;
  segments: Segment[];
  isFadeOut?: boolean;
  isDisease?: boolean;
}

interface SubPathway extends Entity {
  prop: Prop;
  colour: string;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  isFadeOut?: boolean;
}

interface InteractorsSummary {
  shape: Shape;
  type: string;
}

interface Shape {
  type: string;
  a: Position;
  b: Position;
  /** Not in the exporter's reaction layouts, which give only a and b. */
  centre?: Position;
  empty: boolean;
  s: string;
}

interface Attachment {
  description: string;
  label: string;
  reactomeId: number;
  shape: Shape;
}
