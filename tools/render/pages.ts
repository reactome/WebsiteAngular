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
 * that a page is held only after a figure that went cleanly on it: any other
 * is replaced (data-model.md, Replacement), never drawn on again.
 */

/**
 * Why a page was closed rather than held (data-model.md, Replacement):
 *
 * - `failure`: its figure threw, timed out or reported a browser problem, or
 *   the page crashed while it was held. Whatever the figure left behind (a
 *   half-drawn diagram, a wait still polling, an error the site swallowed)
 *   would be the next figure's starting point, and drawn into it unseen.
 * - `browser`: the browser it belonged to went. A page of the old browser
 *   cannot draw, so a figure given one would fail where a fresh page draws.
 *
 * Spec 018 T007 adds `count`, `memory` and `build`.
 */
export type Reason = 'failure' | 'browser';

/**
 * What a figure's result says of its page: `hold` it for the next figure,
 * close it as `spent` (it no longer holds the render page, as after a PDF,
 * which is printed in its place: nothing went wrong), or replace it for a
 * reason.
 */
export type Verdict = 'hold' | 'spent' | Reason;

/** What the pool needs of a page: closing it, with whatever it was opened in. */
export interface Closable {
  close(): Promise<void>;
  /**
   * Whether a held page can still draw: not crashed, nor closed under the
   * pool. A page with no say is taken to be alive.
   */
  alive?(): boolean;
}

export interface PagesOptions<P extends Closable> {
  /** Hold pages between figures; off, each figure has a fresh page. */
  reuse: boolean;
  /** Pages held at most: the figures drawn at once. */
  max: number;
  /** A new page; `held` when it may be held, which wants a context of its own. */
  open(held: boolean): Promise<P>;
}

/**
 * The verdict on a figure the render service drew: a browser problem (an
 * error thrown in the page, or one it logged; what the service's log line
 * counts) replaces the page, even though the figure is answered as before.
 * The error may have come from state the next figure would start from.
 */
export function verdict({
  movable,
  problems,
}: {
  movable: boolean;
  problems: readonly string[];
}): Verdict {
  if (problems.length) return 'failure';
  return movable ? 'hold' : 'spent';
}

export class Pages<P extends Closable> {
  private readonly options: PagesOptions<P>;
  private readonly idle: P[] = [];
  private moves = 0;
  /**
   * Moves on each time every held page is let go of. A page taken before is
   * of what was let go (the old browser), so it is not held after its figure.
   */
  private generation = 0;
  /** Figures drawn on a held page since the start. */
  reused = 0;
  /** Pages replaced since the start, by why. */
  readonly replaced: Record<Reason, number> = { failure: 0, browser: 0 };

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
   * `judge` says `hold`.
   *
   * The figure's own answer, or its own error, is what the caller gets,
   * whatever happens to the page: a failure is answered as it is with reuse
   * off (spec 018 FR-007).
   */
  async use<T>(
    draw: (page: P, nav: string | undefined) => Promise<T>,
    judge: (result: T) => Verdict
  ): Promise<T> {
    if (!this.options.reuse) {
      const page = await this.options.open(false);
      try {
        return await draw(page, undefined);
      } finally {
        await discard(page);
      }
    }

    // Before the page is opened: one opened as the browser goes is the old
    // browser's.
    const generation = this.generation;
    // Taken off the list before drawing, so no other figure can be given it.
    const held = await this.take();
    const page = held ?? (await this.options.open(true));
    const nav = held ? `figure-${++this.moves}` : undefined;
    let outcome: Verdict = 'failure';
    try {
      const result = await draw(page, nav);
      if (held) this.reused++;
      outcome = judge(result);
      return result;
    } finally {
      if (generation !== this.generation) outcome = 'browser';
      if (outcome === 'hold' && this.idle.length < this.options.max) this.idle.push(page);
      else if (outcome === 'hold' || outcome === 'spent') await discard(page);
      else await this.replace(page, outcome);
    }
  }

  /**
   * Lets go of every held page, for a reason that holds for all of them (the
   * browser they belong to has gone), and of every page being drawn on now,
   * once its figure is answered.
   */
  async replaceAll(reason: Reason): Promise<void> {
    this.generation++;
    await Promise.all(this.idle.splice(0).map((page) => this.replace(page, reason)));
  }

  /** A held page that can still draw, replacing any that cannot. */
  private async take(): Promise<P | undefined> {
    for (let page = this.idle.pop(); page; page = this.idle.pop()) {
      // A renderer that died while the page was held: the figure would fail
      // where a fresh page draws it.
      if (page.alive?.() ?? true) return page;
      await this.replace(page, 'failure');
    }
    return undefined;
  }

  /** Closes a page for a reason, and counts it. */
  private async replace(page: P, reason: Reason): Promise<void> {
    this.replaced[reason]++;
    await discard(page);
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
