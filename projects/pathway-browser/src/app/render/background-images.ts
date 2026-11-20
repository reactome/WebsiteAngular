import type cytoscape from 'cytoscape';

/** An image as cytoscape's renderer holds one: loading, loaded, or failed. */
export interface Loadable {
  readonly complete: boolean;
  addEventListener(type: 'load' | 'error', listener: () => void): void;
}

/** What of cytoscape's canvas renderer this reads: its own image cache. */
interface CachingRenderer {
  getCachedImage(url: string, crossOrigin: unknown, onLoad: () => void): Loadable;
}

/** A graph whose renderer this can ask (not in the fork's declarations). */
interface Rendered {
  renderer(): unknown;
}

/** A node's computed style (not in the fork's declarations). */
interface Styled {
  pstyle(name: string): { value: unknown };
}

const hasFunction = (value: unknown, name: string): boolean =>
  typeof value === 'object' &&
  value !== null &&
  typeof (value as Record<string, unknown>)[name] === 'function';

const isCachingRenderer = (value: unknown): value is CachingRenderer =>
  hasFunction(value, 'getCachedImage');
const isRendered = (value: unknown): value is Rendered => hasFunction(value, 'renderer');
const isStyled = (value: unknown): value is Styled => hasFunction(value, 'pstyle');

/** A style value as a list: cytoscape gives a background's values one per image. */
const listOf = (value: unknown): unknown[] => (Array.isArray(value) ? (value as unknown[]) : []);

/**
 * Every background image the graph's nodes draw, as the renderer's own cache
 * holds it (asking for one not yet asked for starts its load, as drawing it
 * would). The export draws from that cache and leaves out an image still
 * loading, so these are what a figure needs loaded before it is taken.
 */
export function backgroundImages(cy: cytoscape.Core): Loadable[] {
  const renderer = isRendered(cy) ? cy.renderer() : undefined;
  if (!isCachingRenderer(renderer)) return [];
  const images: Loadable[] = [];
  cy.nodes().forEach((node: unknown) => {
    if (!isStyled(node)) return;
    const crossOrigins = listOf(node.pstyle('background-image-crossorigin').value);
    listOf(node.pstyle('background-image').value).forEach((url, i) => {
      if (typeof url !== 'string' || url === '' || url === 'none') return;
      images.push(renderer.getCachedImage(url, crossOrigins[i], () => undefined));
    });
  });
  return images;
}

/**
 * Resolves once every image has loaded or failed, true; false if some are
 * still loading after `timeoutMs`.
 *
 * Without this the page said it was ready while the analysis overlays (each
 * node's colouring is a background image) were still loading: a token's
 * figure of R-HSA-69620 had 132 images taken at ready and 252 three seconds
 * later, on fresh pages as on held ones (spec 018 T009). A failed image ends
 * its wait as a loaded one does: the renderer leaves it out either way, and
 * waiting longer would not bring it.
 */
export function whenLoaded(images: readonly Loadable[], timeoutMs = 20_000): Promise<boolean> {
  const loading = images.filter((image) => !image.complete);
  if (loading.length === 0) return Promise.resolve(true);
  return new Promise((resolve) => {
    let left = loading.length;
    const timer = setTimeout(() => resolve(false), timeoutMs);
    const settled = (): void => {
      left -= 1;
      if (left === 0) {
        clearTimeout(timer);
        resolve(true);
      }
    };
    for (const image of loading) {
      let done = false;
      const once = (): void => {
        if (done) return;
        done = true;
        settled();
      };
      image.addEventListener('load', once);
      image.addEventListener('error', once);
    }
  });
}
