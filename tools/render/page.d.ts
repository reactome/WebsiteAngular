// What the render page publishes on `window`, as the service's code that runs
// in the page reads it. The types are the page's own (render-api.model.ts), so
// the two cannot drift apart.
import type {
  RenderExport,
  RenderState,
} from '../../projects/pathway-browser/src/app/render/render-api.model.ts';

/** gifenc, injected into the page by gif.ts: the parts of it gif.ts calls. */
interface GifEnc {
  GIFEncoder(): {
    writeFrame(index: Uint8Array, width: number, height: number, options: object): void;
    finish(): void;
    bytes(): Uint8Array;
  };
  quantize(rgba: Uint8Array | Uint8ClampedArray, colours: number): number[][];
  applyPalette(rgba: Uint8Array | Uint8ClampedArray, palette: number[][]): Uint8Array;
}

declare global {
  interface Window {
    __renderState?: RenderState;
    __renderExport: RenderExport;
    gifenc: GifEnc;
  }
}
