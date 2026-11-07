// The render service (spec 016, T027): tools/render draws a pathway by driving
// the site's own render page (/render) in a browser. Two sides meet here:
// what the page publishes on `window` for the service to read, the shapes a
// PowerPoint is written from among them; and what the service answers over
// HTTP in JSON, its health and its refusals (a figure itself is bytes).

// ---- The page's side --------------------------------------------------------
//
// What the render page publishes on `window` for whatever drives it: the
// render service loads the page in a browser and reads these. The page builds
// them with these types, and the service declares its `window` from them, so
// neither can change them without the other failing to compile.

/** What the page has drawn, by the view that drew it. */
export type Drawn =
  | { view: 'reaction'; instances: 1; elements: number }
  | { view: 'diagram'; instances: number; elements: number; subpathways: boolean }
  | { view: 'ehld'; nodes: number }
  | {
      view: 'reacfoam';
      groups: number;
      box: [number, number];
      /** The species overview's taxId, so a caller can tell it got the one it asked for. */
      species: string;
    };

/** What the page drew, once it has, with what it was asked for. */
export type Published = {
  pathway: string | null;
  /** For a caller labelling the figure: an stId is not a caption. */
  name: string | null;
  /**
   * The analysis coloured on the figure, and the resource it is coloured for:
   * the result's default, as the pathway browser shows it. Null with none.
   */
  analysis: { token: string; resource: string } | null;
} & Drawn;

/**
 * `window.__renderState`: whether the page is ready, and what it drew if it has.
 *
 * `nav` is the id the figure was moved to with `__renderNavigate`, absent on a
 * full load. `build` is the page's main script's name (`main-{hash}.js`), by
 * which a caller holding the page tells it from a newer build of the site;
 * null where the page cannot find it.
 */
export type RenderState = {
  ready: boolean;
  error: string | null;
  nav?: string;
  build: string | null;
} & (Published | { view?: undefined; pathway?: undefined; name?: undefined; analysis?: undefined });

/**
 * `window.__renderNavigate(url, nav)` (spec 018, contracts/render-page.md):
 * moves a loaded render page to the render address `url` without loading it
 * again, its new component carrying `nav`. Resolves true once the move is made,
 * which is not the figure being ready: that is `cr-render[data-render-nav=nav]`
 * ready or in error. Resolves false, and does not move, for anything that is
 * not a render address.
 */
export type RenderNavigate = (url: string, nav: string) => Promise<boolean>;

/** `window.__renderExport`: the artefacts the page can hand over. */
export interface RenderExport {
  svg(): string | Promise<string>;
  /** Null where the view is not made of shapes (an illustration, the genome-wide view). */
  shapes(): RenderShapes | null;
  png(scale?: number): Promise<string>;
  jpeg(scale?: number): Promise<string>;
  /** The analysis's sample names, for an animation; empty without one. */
  samples(): string[];
  showSample(name: string): Promise<void>;
  frameCanvas(scale?: number): Promise<HTMLCanvasElement>;
}

// ---- The shapes ------------------------------------------------------------

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
  /** The thing this shape is part of; see {@link RenderGrouping}. */
  group?: string;
  /** What that thing is called in the slide's object list. */
  groupName?: string;
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
  /** The thing this shape is part of; see {@link RenderGrouping}. */
  group?: string;
  /** What that thing is called in the slide's object list. */
  groupName?: string;
}

/**
 * Shapes sharing a `group` are one thing on the diagram -- an entity's body and
 * the box carrying its label, or a reaction's lines, arrowheads and node -- and
 * an exporter that can group shapes (PowerPoint) makes them one object, so a
 * person moves the thing rather than each piece of it (#299). A group's shapes
 * are listed together, at the place in the drawing order the group is drawn.
 */
export type RenderGrouping = Pick<RenderNodeShape, 'group' | 'groupName'>;

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

// ---- The service's answers -------------------------------------------------

/** /health: what the service is, and how busy. */
export interface RenderHealth {
  ok: true;
  /** A hash of the service's own modules, so two deployments can be told apart. */
  build: string;
  modules: number;
  /** The site whose render page it drives. */
  base: string;
  cache: string;
  /** The cache's version: it changes whenever the figures do. */
  cacheKey: string;
  /** Where the page reads the release's diagram files from. */
  files: 'local' | 'download site';
  /** Renders running, and waiting. */
  active: number;
  waiting: number;
  /** Counted since the service started. */
  served: number;
  hits: number;
  rendered: number;
  failed: number;
  rejected: number;
  evicted: number;
}

/**
 * A figure refused (400), or one that failed (another status): why, and, for a request it
 * refuses, what it would take instead: the formats or parameters it knows, and
 * the request as it would accept it (`canonical`), where there is one.
 */
export interface RenderRefusal {
  error: string;
  formats?: readonly string[];
  accepted?: readonly string[];
  canonical?: string;
}
