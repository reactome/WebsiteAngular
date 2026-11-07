import { inject, Injectable, Injector } from '@angular/core';
import { ActivatedRouteSnapshot, BaseRouteReuseStrategy, Router } from '@angular/router';

// The part of moving a render page to its next figure (render-navigation.ts)
// that the root router needs. A module of its own, because the root config
// puts what it imports in the site's initial bundle, which is held to a
// budget; the rest loads with the render page.

/** Route data marking a render route, whose component a move recreates. */
export const RENDER_FIGURE = 'renderFigure';

/** What `__renderNavigate` puts on its navigation, and no other navigation carries. */
export interface RenderNavigationInfo {
  renderNav: string;
}

function isRenderNavigationInfo(info: unknown): info is RenderNavigationInfo {
  return (
    typeof info === 'object' &&
    info !== null &&
    'renderNav' in info &&
    typeof info.renderNav === 'string'
  );
}

/** The id of the move under way, or null for any other navigation (a full load among them). */
export function currentRenderNav(router: Router): string | null {
  const info = router.currentNavigation()?.extras.info;
  return isRenderNavigationInfo(info) ? info.renderNav : null;
}

/**
 * Recreates a render route's component, but only on a move `__renderNavigate`
 * started.
 *
 * Without it Angular keeps the component across `render/A` → `render/B` (the
 * same route), and every address it read at construction stays the first
 * figure's: `render/A?dark=true` then `render/B` draws B dark.
 *
 * Only on a move, because the page rewrites its own address after drawing (a
 * reaction's id becomes its pathway with `?select=`), and that is a navigation
 * too. Recreating on it replaced the new figure's component with one that had
 * no move id, and the caller waited for a figure that never came: 80 of 200
 * timed out in spec 018's prototype (research R4 result, 1).
 */
@Injectable()
export class RenderReuseStrategy extends BaseRouteReuseStrategy {
  // The router injects this strategy, so the strategy cannot inject the router
  // when it is made; it asks for it when a navigation is under way.
  private readonly injector = inject(Injector);

  override shouldReuseRoute(future: ActivatedRouteSnapshot, curr: ActivatedRouteSnapshot) {
    if (future.data[RENDER_FIGURE] === true && currentRenderNav(this.injector.get(Router)) !== null)
      return false;
    return super.shouldReuseRoute(future, curr);
  }
}
