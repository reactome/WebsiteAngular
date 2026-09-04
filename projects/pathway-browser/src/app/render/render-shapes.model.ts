/**
 * A diagram described as shapes, for exporters that draw shapes rather than
 * pictures.
 *
 * PowerPoint is the reason this exists. A .pptx holding one picture is one
 * object on the slide: curators asked for the diagram's parts, and reported that
 * "the whole pathway diagram is treated as a single item". The Java exporter
 * emits a shape per glyph, so this describes the same thing in terms an OOXML
 * writer can use without knowing anything about cytoscape.
 *
 * Deliberately flat and serialisable: it crosses from the page into the render
 * service through `page.evaluate`, so it has to survive being turned into JSON.
 */

/** Preset geometries an OOXML writer can name directly. */
export type ShapeGeometry = 'roundRect' | 'rect' | 'ellipse';

export interface RenderNodeShape {
  kind: 'node';
  id: string;
  /** What the shape is called in the slide's object list. */
  name: string;
  x: number;
  y: number;
  w: number;
  h: number;
  geom: ShapeGeometry;
  fill: string | null;
  stroke: string | null;
  strokeWidth: number;
  label: string;
  fontSize: number;
  fontColor: string | null;
  bold: boolean;
}

export interface RenderEdgeShape {
  kind: 'edge';
  id: string;
  name: string;
  /** Source, any bend points, then target -- in diagram coordinates. */
  points: { x: number; y: number }[];
  stroke: string | null;
  strokeWidth: number;
  /** Reactions draw arrowheads; a plain link does not. */
  arrow: boolean;
}

export interface RenderShapes {
  /** The extent every coordinate above is relative to. */
  x: number;
  y: number;
  width: number;
  height: number;
  shapes: (RenderNodeShape | RenderEdgeShape)[];
}
