/**
 * The render service's pages (spec 018, research R3): with reuse on, a page
 * that has loaded the render page is held between figures and moved to the
 * next one inside the app, so the site's code starts once per page rather
 * than once per figure. With it off, every figure gets a fresh page, as
 * before reuse existed; that is also what a reused figure is compared against.
 *
 * What makes a held page safe to use again is the render page's, not this
 * module's: each move recreates the render component and starts it as a
 * fresh page starts (render-navigation.ts and start-as-fresh.ts in the site).
 * What this module keeps is that a page is never given to two figures at
 * once, that no more pages are held than figures can be drawn at once, and
 * that a page is held only after a figure that succeeded on it.
 */

/** What the pool needs of a page: closing it, with whatever it was opened in. */
export interface Closable {
  close(): Promise<void>;
}

export interface PagesOptions<P extends Closable> {
  /** Hold pages between figures; off, each figure has a fresh page. */
  reuse: boolean;
  /** Pages held at most: the figures drawn at once. */
  max: number;
  /** A new page; `held` when it may be held, which wants a context of its own. */
  open(held: boolean): Promise<P>;
}

export class Pages<P extends Closable> {
  private readonly options: PagesOptions<P>;
  private readonly idle: P[] = [];
  private moves = 0;
  /** Figures drawn on a held page since the start. */
  reused = 0;

  constructor(options: PagesOptions<P>) {
    this.options = options;
  }

  /** Pages held now, between figures. */
  get held(): number {
    return this.idle.length;
  }

  /**
   * Draws one figure on a page. `draw` is given the page and, on a held one,
   * the id to move it with; with none, the page is new and the figure is a
   * full load. The page is held afterwards only if the figure succeeded and
   * `reusable` says its result left the page usable.
   */
  async use<T>(
    draw: (page: P, nav: string | undefined) => Promise<T>,
    reusable: (result: T) => boolean
  ): Promise<T> {
    if (!this.options.reuse) {
      const page = await this.options.open(false);
      try {
        return await draw(page, undefined);
      } finally {
        await discard(page);
      }
    }

    // Taken off the list before drawing, so no other figure can be given it.
    const held = this.idle.pop();
    const page = held ?? (await this.options.open(true));
    const nav = held ? `figure-${++this.moves}` : undefined;
    let keep = false;
    try {
      const result = await draw(page, nav);
      if (held) this.reused++;
      keep = reusable(result);
      return result;
    } finally {
      // A figure that failed may have left anything behind -- a half-drawn
      // diagram, a wait still polling -- and the next figure would start from
      // it. A fresh page starts from nothing, so a failure costs only a load.
      if (keep && this.idle.length < this.options.max) this.idle.push(page);
      else await discard(page);
    }
  }

  /** Closes every held page: the browser they belong to is going. */
  async closeAll(): Promise<void> {
    await Promise.all(this.idle.splice(0).map(discard));
  }
}

/**
 * Closes a page that is being given up. One whose browser has gone fails to
 * close, and is gone already; the figure's own answer is what the caller
 * needs, not this.
 */
async function discard(page: Closable): Promise<void> {
  try {
    await page.close();
  } catch {
    // Already closed with its browser.
  }
}
