import { PRIMARY_OUTLET, Router, UrlTree } from '@angular/router';
import type { RenderExport, RenderNavigate, RenderState } from '../../../../contract/render.ts';
import type { RenderNavigationInfo } from './render-reuse-strategy';

/**
 * Moving a loaded render page to its next figure without loading it again
 * (spec 018, contracts/render-page.md). Loading the page is most of a figure's
 * time; starting the site's code once per page instead of once per figure is
 * the whole saving.
 *
 * The render component reads its address once, when it is constructed, and
 * assumes one figure a lifetime. So a move does not tell the component about a
 * new address: it destroys it and constructs another, which reads the new
 * address exactly as on a fresh page (RenderReuseStrategy).
 */

// What the render page puts on `window` (projects/contract/render.ts).
declare global {
  interface Window {
    __renderNavigate?: RenderNavigate;
    __renderState?: RenderState;
    __renderExport?: RenderExport;
  }
}

/** `/PathwayBrowser/render` or `/PathwayBrowser/render/{id}`, with any query, and nothing else. */
function isRenderAddress(tree: UrlTree): boolean {
  const primary = tree.root.children[PRIMARY_OUTLET];
  if (!primary || Object.keys(tree.root.children).length !== 1) return false;
  if (Object.keys(primary.children).length > 0) return false;
  const [app, render, ...rest] = primary.segments.map((segment) => segment.path);
  return (
    app === 'PathwayBrowser' &&
    render === 'render' &&
    rest.length <= 1 &&
    primary.segments.every((segment) => Object.keys(segment.parameters).length === 0)
  );
}

/**
 * Moves the page to the render address `url`, the new component carrying `nav`.
 * Resolves false, without moving, for anything that is not a render address.
 */
export async function renderNavigate(router: Router, url: string, nav: string): Promise<boolean> {
  let tree: UrlTree;
  try {
    tree = router.parseUrl(url);
  } catch {
    return false;
  }
  if (!isRenderAddress(tree)) return false;
  const info: RenderNavigationInfo = { renderNav: nav };
  return router.navigateByUrl(tree, {
    info,
    // The same figure asked for again (another format of it, say) is the same
    // address. The router ignores a navigation to where it already is, so no
    // component would be made and the caller would wait for its `nav` forever.
    onSameUrlNavigation: 'reload',
  });
}

/** Puts `__renderNavigate` on the page. Each render component does; a later one's is the same function. */
export function installRenderNavigate(router: Router): void {
  window.__renderNavigate = (url, nav) => renderNavigate(router, url, nav);
}

/**
 * The page's build: its main script's name, which the production build
 * content-hashes (`main-{hash}.js`). The service compares it with the name the
 * site serves now; a held page whose build is not the site's would draw the
 * old code's figures (research R3). Null when no such script is found.
 */
export function pageBuild(doc: Document = document): string | null {
  for (const script of Array.from(doc.querySelectorAll<HTMLScriptElement>('script[src]'))) {
    const name = new URL(script.src, doc.baseURI).pathname.split('/').pop() ?? '';
    if (/^main(-[A-Za-z0-9]+)?\.js$/.test(name)) return name;
  }
  return null;
}
