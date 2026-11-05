// T001 PROTOTYPE (spec 018): not for merging. Moves a loaded render page to the next
// figure inside the app, with the render component recreated each time.
import { ActivatedRouteSnapshot, BaseRouteReuseStrategy, Router } from '@angular/router';

// Only a move to the next figure recreates the component. The page's own address
// rewrites (a reaction's id becoming its pathway and ?select=) are navigations too,
// and must keep the component, as they do on a fresh page.
let recreating = false;

export class RenderReuseStrategy extends BaseRouteReuseStrategy {
  override shouldReuseRoute(future: ActivatedRouteSnapshot, curr: ActivatedRouteSnapshot) {
    if (recreating && (future.data['recreate'] || curr.data['recreate'])) return false;
    return super.shouldReuseRoute(future, curr);
  }
}

let pendingNav: string | null = null;

export function takeNav(): string | null {
  const nav = pendingNav;
  pendingNav = null;
  return nav;
}

export function installNavigate(router: Router) {
  (window as unknown as Record<string, unknown>)['__renderNavigate'] = async (
    url: string,
    nav: string
  ) => {
    if (!/^\/PathwayBrowser\/render(\/|\?|$)/.test(url)) return false;
    pendingNav = nav;
    recreating = true;
    try {
      return await router.navigateByUrl(url);
    } finally {
      recreating = false;
    }
  };
}
