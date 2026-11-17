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
 * - `count`: it has drawn `maxFigures`. What a page keeps that no figure
 *   gives back grows with every figure it draws (research R4; T007's run).
 * - `memory`: the service's container was past its bound after a figure.
 *   A browser page's memory is mostly outside its JavaScript heap, freed when
 *   it closes; four held pages and a large diagram took a container past its
 *   limit, and every figure drawn then failed (research R4 result, 3).
 * - `build`: the site's build is no longer the one the page loaded. A held
 *   page keeps the code it started with, and would draw the old build's
 *   figures under the new one's (FR-008).
 */
export type Reason = 'failure' | 'browser' | 'count' | 'memory' | 'build';

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
  /**
   * The site build the page loaded (the render page's `__renderState.build`),
   * once its first figure has said; null or absent when it cannot tell.
   */
  loaded?: string | null;
}

export interface PagesOptions<P extends Closable> {
  /** Hold pages between figures; off, each figure has a fresh page. */
  reuse: boolean;
  /** Pages held at most: the figures drawn at once. */
  max: number;
  /** A new page; `held` when it may be held, which wants a context of its own. */
  open(held: boolean): Promise<P>;
  /** Figures a page draws before it is replaced (`RENDER_REUSE_MAX`); unset, no limit. */
  maxFigures?: number;
  /**
   * Whether the service is past its memory bound (`RENDER_REUSE_MEMORY`),
   * asked after each figure whose page would be held.
   */
  overMemory?(): boolean;
  /**
   * The site's build now, as the render page names it; null when it cannot be
   * read, and then no page is replaced for its build. Asked before a held page
   * is given a figure.
   */
  siteBuild?(): Promise<string | null>;
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
  /** Figures drawn on each page. */
  private readonly figures = new WeakMap<P, number>();
  private moves = 0;
  /**
   * Moves on each time every held page is let go of. A page taken before is
   * of what was let go (the old browser), so it is not held after its figure.
   */
  private generation = 0;
  /** Figures drawn on a held page since the start. */
  reused = 0;
  /** Pages replaced since the start, by why. */
  readonly replaced: Record<Reason, number> = {
    failure: 0,
    browser: 0,
    count: 0,
    memory: 0,
    build: 0,
  };

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
      this.figures.set(page, (this.figures.get(page) ?? 0) + 1);
      outcome = judge(result);
      return result;
    } finally {
      if (generation !== this.generation) outcome = 'browser';
      else if (outcome === 'hold') outcome = this.lastFigure(page);
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

  /** Whether a page that drew cleanly has drawn its last: its count, or the memory bound. */
  private lastFigure(page: P): Verdict {
    if ((this.figures.get(page) ?? 0) >= (this.options.maxFigures ?? Infinity)) return 'count';
    if (this.options.overMemory?.()) return 'memory';
    return 'hold';
  }

  /** A held page that can still draw the site's current figures, replacing any that cannot. */
  private async take(): Promise<P | undefined> {
    if (!this.idle.length) return undefined;
    const site = await this.currentBuild();
    for (let page = this.idle.pop(); page; page = this.idle.pop()) {
      // A renderer that died while the page was held: the figure would fail
      // where a fresh page draws it.
      if (!(page.alive?.() ?? true)) await this.replace(page, 'failure');
      // The old build's code: its figure would not be the current site's.
      else if (site && page.loaded && page.loaded !== site) await this.replace(page, 'build');
      else return page;
    }
    return undefined;
  }

  /** The site's build, or null when it cannot be read: a page is not replaced on a guess. */
  private async currentBuild(): Promise<string | null> {
    try {
      return (await this.options.siteBuild?.()) ?? null;
    } catch {
      return null;
    }
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

/**
 * The share of its memory limit the service uses, from its cgroup (v2:
 * `memory.current` against `memory.max`): the nearest limit, from the
 * process's own group up, as one set on its container or its unit. Undefined
 * with no limit to read, and then only the count applies. `read` reads a file
 * beneath the cgroup root; `group` is the process's own (`/` in a container).
 */
export function memoryShare(
  read: (file: string) => string | undefined,
  group = '/'
): number | undefined {
  for (let dir = group.replace(/\/+$/, ''); ; dir = dir.slice(0, dir.lastIndexOf('/'))) {
    // `max` reads "max" where no limit is set: not a number.
    const max = Number(read(`${dir}/memory.max`)?.trim());
    if (Number.isFinite(max) && max > 0) {
      const current = Number(read(`${dir}/memory.current`)?.trim());
      return Number.isFinite(current) ? current / max : undefined;
    }
    if (!dir) return undefined;
  }
}

/**
 * The site's build in the render page's HTML: the name of its main script
 * (`main-{hash}.js`), as the page itself reports it (`pageBuild` in the site's
 * render-navigation.ts). Null when there is none.
 */
export function buildIn(html: string): string | null {
  for (const [, src = ''] of html.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["']/gi)) {
    const name = src.split(/[?#]/)[0]?.split('/').pop() ?? '';
    if (/^main(-[A-Za-z0-9]+)?\.js$/.test(name)) return name;
  }
  return null;
}

/**
 * `load`, asked at most once per `ms`: within it, the last answer (or the one
 * on its way). A failed load is null, and asked again after `ms` like any other.
 */
export function atMostEvery(
  ms: number,
  load: () => Promise<string | null>,
  now: () => number = Date.now
): () => Promise<string | null> {
  let last: { at: number; answer: Promise<string | null> } | undefined;
  return () => {
    if (!last || now() - last.at >= ms) {
      last = { at: now(), answer: load().catch(() => null) };
    }
    return last.answer;
  };
}
