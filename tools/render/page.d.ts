// What the render page publishes on `window`, as the service's code that runs
// in the page reads it. The types are the contract's, which the page builds
// with (projects/contract/render.ts), so the two cannot drift apart.
import type { RenderExport, RenderNavigate, RenderState } from '../../projects/contract/render.ts';

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
    __renderNavigate?: RenderNavigate;
    __renderExport: RenderExport;
    gifenc: GifEnc;
  }
}
