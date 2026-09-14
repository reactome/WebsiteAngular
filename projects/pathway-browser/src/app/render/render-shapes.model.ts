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

/**
 * A colour as lowercase hex digits with no leading `#`: six when the colour is
 * opaque, eight when it is not, the last pair being alpha. Null means no colour
 * at all -- a fully transparent glyph, or a style an exporter should leave
 * unpainted rather than guess at.
 *
 * The page resolves whatever the live stylesheet holds -- `rgb()`, `rgba()`,
 * hex long or short, and the separate opacity a diagram style carries -- down
 * to this one spelling, so an exporter has a single form to read. Written down
 * because it is not the form any of those sources uses: an exporter that
 * assumed `#rrggbb` silently painted nothing, and one that ignored the alpha
 * painted this pathway's compartments as solid slabs over their own contents.
 */
export type ShapeColour = string | null;

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
  fill: ShapeColour;
  stroke: ShapeColour;
  strokeWidth: number;
  label: string;
  fontSize: number;
  fontColor: ShapeColour;
  bold: boolean;
  /** A broken border, which the diagram uses to mark inferred entities. */
  dashed: boolean;
}

/**
 * A polyline, and also the shape every arrowhead is drawn as.
 *
 * An arrowhead is geometry, not a line decoration. The diagram draws four of
 * them and three carry meaning a triangle does not: catalysis is a hollow
 * circle, positive regulation a hollow triangle, and negative regulation a bar
 * across the line. OOXML's line ends offer `triangle`, `oval`, `stealth`,
 * `diamond` and `arrow`, always filled and always the line's own colour -- so a
 * tee has no spelling there at all, and an export that reached for the nearest
 * line end drew inhibition as activation. Handing over the points instead means
 * the exporter needs to know none of that.
 */
export interface RenderEdgeShape {
  kind: 'edge';
  id: string;
  name: string;
  /** Source, any bend points, then target -- in diagram coordinates. */
  points: { x: number; y: number }[];
  stroke: ShapeColour;
  strokeWidth: number;
  /** Closed and filled, for an arrowhead; open and stroked, for a connector. */
  closed: boolean;
  fill: ShapeColour;
  /** A broken line, which the diagram uses for the links between glyphs. */
  dashed: boolean;
}

export interface RenderShapes {
  /**
   * The extent every coordinate above is relative to -- the framed region when
   * the request asked for one event, and the whole diagram otherwise, matching
   * what the SVG export covers for the same request.
   */
  x: number;
  y: number;
  width: number;
  height: number;
  /**
   * Draw order, back to front. An exporter can emit these in the order given:
   * formats that paint in document order will then stack them as the diagram
   * does, with compartments behind, connectors next, and entities in front.
   */
  shapes: (RenderNodeShape | RenderEdgeShape)[];
}
