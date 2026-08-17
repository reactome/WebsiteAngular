import { Injectable, signal } from '@angular/core';
import { mapNavOptions } from '../utils/nav-options-mapper';
import { NavOption } from '../types/link';

/**
 * Single source for the navigation options loaded from config/nav-options.json.
 *
 * Fourteen components previously each did their own
 * `import('../../config/nav-options.json').then(d => this.navOptions = ...)`.
 * That duplicated the load in every component and, more importantly, assigned a
 * plain field from a promise callback: nothing tells Angular the value arrived.
 * Under zone.js that happened to work because zone re-checked the whole tree
 * after the promise settled; without zones the nav would simply never render.
 *
 * Exposing it as a signal fixes both -- the load happens once, and setting the
 * signal notifies exactly the views that read it.
 */
@Injectable({ providedIn: 'root' })
export class NavOptionsService {
  private readonly _navOptions = signal<Record<string, NavOption>>({});

  /** Empty until the JSON resolves, then populated. */
  readonly navOptions = this._navOptions.asReadonly();

  constructor() {
    import('../config/nav-options.json')
      .then((data) => {
        this._navOptions.set(mapNavOptions(data.default));
      })
      // Without this a failed load leaves every navigation menu empty and says
      // nothing -- the same silent-stale-view problem the signal was meant to
      // solve, one layer down.
      .catch((error) => console.error('Could not load navigation options', error));
  }
}
