import type { RenderShapes } from './render-shapes.model';

/**
 * What the render page publishes on `window` for whatever drives it -- the
 * render service (tools/render) loads the page in a browser and reads these.
 * One definition for both sides (spec 013): the page builds them with these
 * types, and the service declares its `window` from them, so neither can
 * change the contract without the other failing to compile.
 */

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
} & Drawn;

/** `window.__renderState`: whether the page is ready, and what it drew if it has. */
export type RenderState = { ready: boolean; error: string | null } & (
  Published | { view?: undefined; pathway?: undefined; name?: undefined }
);

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
