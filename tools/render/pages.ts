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
import type { RenderHealth, RenderReplacement } from '../../projects/contract/render.ts';

/**
 * Why a page was closed rather than held (data-model.md, Replacement):
 *
 * - `failure`: its figure threw, timed out or reported a problem in the page
 *   (an uncaught error, not a console error alone: `verdict`), or the page
 *   crashed while it was held. Whatever the figure left behind (a half-drawn
 *   diagram, a wait still polling, a request still pending) would be the next
 *   figure's starting point, and drawn into it unseen.
 * - `browser`: the browser it belonged to went. A page of the old browser
 *   cannot draw, so a figure given one would fail where a fresh page draws.
 * - `count`: it has drawn `maxFigures`. What a page keeps that no figure
 *   gives back grows with every figure it draws (research R4; T007's run).
 * - `memory`: the service's container was past its bound after a figure
 *   (`memoryVerdict`). A browser page's memory is mostly outside its
 *   JavaScript heap, freed when it closes; four held pages and a large diagram
 *   took a container past its limit, and every figure drawn then failed
 *   (research R4 result, 3).
 * - `build`: the site's build is no longer the one the page loaded. A held
 *   page keeps the code it started with, and would draw the old build's
 *   figures under the new one's (FR-008).
 */
export type Reason = RenderReplacement;

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
   * The service's share of its memory limit now, asked after each figure
   * whose page would be held; undefined with no limit to read, and then no
   * page is replaced for memory.
   */
  memory?(): number | undefined;
  /** The share past which pages are replaced for memory (`RENDER_REUSE_MEMORY`, `memoryVerdict`). */
  memoryBound?: number;
  /**
   * The site's build now, as the render page names it; null when it cannot be
   * read, and then no page is replaced for its build. Asked before a held page
   * is given a figure.
   */
  siteBuild?(): Promise<string | null>;
}

/**
 * How a console error the page logged is told apart among a figure's
 * problems (render-core.ts writes them so): `console: ` and the message.
 */
export const LOGGED = 'console: ';

/**
 * The verdict on a figure the render service drew: a problem that may have
 * broken the page replaces it, even though the figure is answered as before.
 * Such a problem may be in the state the next figure would start from: an
 * error thrown in the page and not caught (`pageerror`), or a request for a
 * release file left unanswered (`files: `), still pending when the next
 * figure starts.
 *
 * A console error the page logged is not one (spec 018 T015). The figures
 * that log them log them on a fresh page too (a 404 for a picture, "Missing
 * graph data for node" in a disease reaction's layout): they are said of the
 * figure's data, not of the page, and replacing the page bought nothing
 * (T009: 1,168 replacements; T010: 1,278). They are still counted in the
 * service's log line.
 */
export function verdict({
  movable,
  problems,
}: {
  movable: boolean;
  problems: readonly string[];
}): Verdict {
  if (problems.some((problem) => !problem.startsWith(LOGGED))) return 'failure';
  return movable ? 'hold' : 'spent';
}

export class Pages<P extends Closable> {
  private readonly options: PagesOptions<P>;
  private readonly idle: P[] = [];
  /** Figures ended since a page was last replaced for memory (`memoryVerdict`). */
  private sinceMemory = Infinity;
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

  /** What `/health` says of the pages with reuse on (contracts/health.md). */
  health(): Required<Pick<RenderHealth, 'pages' | 'reused' | 'replaced'>> {
    return { reused: this.reused, pages: this.held, replaced: { ...this.replaced } };
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
      this.sinceMemory++;
      if (generation !== this.generation) outcome = 'browser';
      else if (outcome === 'hold') outcome = this.lastFigure(page);
      if (outcome === 'memory') this.sinceMemory = 0;
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
    const { memoryBound } = this.options;
    const share = this.options.memory?.();
    if (share === undefined || memoryBound === undefined) return 'hold';
    return memoryVerdict({
      share,
      bound: memoryBound,
      figures: this.figures.get(page) ?? 0,
      since: this.sinceMemory,
      pages: this.options.max,
    });
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
 * Whether a page that drew cleanly goes for memory after its figure (spec 018
 * T015): `memory`, or `hold`.
 *
 * - **At or under `bound`:** held.
 * - **Past the ceiling, a quarter of the way from `bound` to the limit:**
 *   replaced, as every page whose figure ends there (T007's rule, at the
 *   bound then). The container is near its limit, and a large figure drawn now
 *   would take it over (research R4 result, 3). With it halfway, a first
 *   version of this rule peaked 460 MiB above T007's on T015's sample; a
 *   quarter of the way, within 200 MiB of it (tasks.md, T015).
 * - **Between them: one page in each round of figures (`pages` figures ended
 *   since the last went), and only one that has drawn more than one.** Every
 *   page past the bound went before T015. In T010's run the container stayed
 *   past half its 3 GB for over an hour while every page was replaced after
 *   its first figure and none was held: replacing them gave nothing back. A
 *   page that has drawn one figure holds what a new page would hold after it,
 *   so replacing it gives nothing back; and a page replaced gives its memory
 *   back only once it has closed, so the share read as the next few figures
 *   end does not yet show it.
 *
 * `figures` is what this page has drawn; `since`, the figures ended since a
 * page was last replaced for memory, this one among them; `pages`, the pages
 * drawn on at once.
 */
export function memoryVerdict({
  share,
  bound,
  figures,
  since,
  pages,
}: {
  share: number;
  bound: number;
  figures: number;
  since: number;
  pages: number;
}): 'hold' | 'memory' {
  if (share <= bound) return 'hold';
  if (share > bound + (1 - bound) / 4) return 'memory';
  return figures > 1 && since >= pages ? 'memory' : 'hold';
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
