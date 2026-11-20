import { describe, expect, it } from 'vitest';
import {
  Pages,
  atMostEvery,
  buildIn,
  memoryShare,
  memoryVerdict,
  verdict,
  LOGGED,
  type PagesOptions,
  type Verdict,
} from './pages.ts';

/** A stand-in page: which it is, whether it is closed, and whether it was opened to be held. */
interface Stand {
  id: number;
  held: boolean;
  closed: boolean;
  crashed: boolean;
  loaded?: string | null;
  close(): Promise<void>;
  alive(): boolean;
}

/** A pool over stand-in pages, recording every page it opens. */
function pool(
  reuse: boolean,
  max = 2,
  rules: Pick<PagesOptions<Stand>, 'maxFigures' | 'memory' | 'memoryBound' | 'siteBuild'> = {}
) {
  const opened: Stand[] = [];
  const pages = new Pages<Stand>({
    reuse,
    max,
    ...rules,
    async open(held) {
      const page: Stand = {
        id: opened.length + 1,
        held,
        closed: false,
        crashed: false,
        async close() {
          this.closed = true;
        },
        alive() {
          return !this.crashed && !this.closed;
        },
      };
      opened.push(page);
      return page;
    },
  });
  const open = () => opened.filter((page) => !page.closed).length;
  return { pages, opened, open };
}

/** A figure that takes a turn of the event loop, as a real one takes seconds. */
const figure = async (page: Stand, nav: string | undefined) => {
  await new Promise((resolve) => setTimeout(resolve, 1));
  return { page, nav };
};
const always = (): Verdict => 'hold';

describe('pages with reuse off (spec 018, RENDER_REUSE off)', () => {
  it('give every figure a fresh page, closed after it, with nothing held', async () => {
    const { pages, opened, open } = pool(false);
    for (let at = 0; at < 3; at++) {
      const { page, nav } = await pages.use(figure, always);
      expect(nav, 'a full load').toBeUndefined();
      expect(page.held, "today's page, not one opened to be held").toBe(false);
    }
    expect(opened).toHaveLength(3);
    expect(open()).toBe(0);
    expect(pages.held).toBe(0);
    expect(pages.reused).toBe(0);
  });
});

describe('pages with reuse on (spec 018, RENDER_REUSE on)', () => {
  it('load a new page fully, then move it to each later figure with an id of its own', async () => {
    const { pages, opened } = pool(true);
    const first = await pages.use(figure, always);
    const second = await pages.use(figure, always);
    const third = await pages.use(figure, always);
    expect(opened).toHaveLength(1);
    expect(first.nav).toBeUndefined();
    expect(second.page).toBe(first.page);
    expect(second.nav).toBeDefined();
    expect(third.nav).toBeDefined();
    expect(third.nav).not.toBe(second.nav);
    expect(pages.reused).toBe(2);
    expect(first.page.held, 'opened in a context of its own').toBe(true);
  });

  it('hold no more pages than figures are drawn at once', async () => {
    const { pages, open } = pool(true, 2);
    let most = 0;
    const watched = async (page: Stand, nav: string | undefined) => {
      most = Math.max(most, open());
      return figure(page, nav);
    };
    // As schedule() runs them: two at a time.
    for (let round = 0; round < 5; round++) {
      await Promise.all([pages.use(watched, always), pages.use(watched, always)]);
      expect(pages.held).toBeLessThanOrEqual(2);
    }
    expect(most).toBe(2);
    expect(open()).toBe(2);
  });

  it('hold no more than the cap even when more figures than that end at once', async () => {
    // schedule() never runs more than the cap at once; this is the pool's own bound.
    const { pages, open } = pool(true, 2);
    await Promise.all([1, 2, 3].map(() => pages.use(figure, always)));
    expect(pages.held).toBe(2);
    expect(open()).toBe(2);
  });

  it('never give one page to two figures at once', async () => {
    const { pages } = pool(true, 3);
    const busy = new Set<number>();
    let shared = false;
    const exclusive = async (page: Stand, nav: string | undefined) => {
      if (busy.has(page.id)) shared = true;
      busy.add(page.id);
      try {
        return await figure(page, nav);
      } finally {
        busy.delete(page.id);
      }
    };
    for (let round = 0; round < 5; round++)
      await Promise.all([1, 2, 3].map(() => pages.use(exclusive, always)));
    expect(shared).toBe(false);
  });

  it('close a page whose figure failed, and draw the next on another', async () => {
    const { pages, opened } = pool(true);
    const first = await pages.use(figure, always);
    await expect(
      pages.use(async () => {
        throw new Error('nothing drawn');
      }, always)
    ).rejects.toThrow('nothing drawn');
    expect(first.page.closed).toBe(true);
    const next = await pages.use(figure, always);
    expect(next.page).not.toBe(first.page);
    expect(next.nav, 'a new page is a full load').toBeUndefined();
    expect(opened).toHaveLength(2);
  });

  it('close a page its figure left unusable (a PDF printed in its place)', async () => {
    const { pages } = pool(true);
    const first = await pages.use(figure, () => 'spent');
    expect(first.page.closed).toBe(true);
    expect(pages.held).toBe(0);
    expect(pages.replaced, 'nothing went wrong').toEqual({
      failure: 0,
      browser: 0,
      count: 0,
      memory: 0,
      build: 0,
    });
  });

  it('answer a figure even when its page cannot be closed, as with its browser gone', async () => {
    const pages = new Pages({
      reuse: true,
      max: 1,
      open: async () => ({
        async close() {
          throw new Error('Target page, context or browser has been closed');
        },
      }),
    });
    await expect(
      pages.use(async () => {
        throw new Error('the figure failed');
      }, always)
    ).rejects.toThrow('the figure failed');
  });
});

/** A figure that fails as Playwright fails one: thrown, after a turn of the event loop. */
const failing = (error: Error) => async () => {
  await new Promise((resolve) => setTimeout(resolve, 1));
  throw error;
};

/** What a timed-out wait throws (Playwright's TimeoutError, by name). */
const timeout = () =>
  Object.assign(new Error('page.waitForSelector: Timeout 45000ms exceeded.'), {
    name: 'TimeoutError',
  });

/** A figure the service drew, as its job returns it: bytes, and what the page reported. */
const drawn =
  (problems: string[], movable = true) =>
  async (page: Stand, nav: string | undefined) => {
    await new Promise((resolve) => setTimeout(resolve, 1));
    return { page, nav, bytes: 'figure', movable, problems };
  };

describe('the verdict on a figure the service drew (spec 018 FR-005)', () => {
  it('holds a page that drew cleanly, and replaces one with a problem in the page', () => {
    expect(verdict({ movable: true, problems: [] })).toBe('hold');
    // An uncaught error (`pageerror`), as render-core.ts records it.
    expect(verdict({ movable: true, problems: ['TypeError: x is undefined'] })).toBe('failure');
    // A release file the page asked for and was never answered.
    expect(verdict({ movable: true, problems: ['files: Error: EIO: i/o error, read'] })).toBe(
      'failure'
    );
  });

  it('holds a page whose figure logged console errors that a fresh page logs too (T015)', () => {
    // What T009 and T010 replaced pages for, and what a fresh page logs for
    // the same figures: a 404 for a picture, and a disease reaction's layout.
    const logged = [
      `${LOGGED}Failed to load resource: the server responded with a status of 404 ()`,
      `${LOGGED}Missing graph data for node:  4 . Potential reason could be a wrong normal pathway for a disease`,
    ];
    expect(verdict({ movable: true, problems: logged })).toBe('hold');
    expect(verdict({ movable: false, problems: logged })).toBe('spent');
    // Logged errors beside one in the page: the page goes.
    expect(verdict({ movable: true, problems: [...logged, 'Error: boom'] })).toBe('failure');
  });

  it('closes, without counting, a page that no longer holds the render page', () => {
    expect(verdict({ movable: false, problems: [] })).toBe('spent');
    // A PDF whose figure also reported a problem in the page is a failure all the same.
    expect(verdict({ movable: false, problems: ['Error: boom'] })).toBe('failure');
  });
});

describe('replacing a held page (spec 018 T006, data-model Replacement)', () => {
  // Each reason: the page is closed, counted, and the next figure is a full
  // load on another page, which is how a fresh page draws it.
  async function afterwards(
    pages: Pages<Stand>,
    opened: Stand[],
    first: Stand,
    reason: 'failure' | 'browser'
  ) {
    expect(first.closed, 'the page is closed').toBe(true);
    expect(pages.held).toBe(0);
    expect(pages.replaced[reason]).toBe(1);
    const reused = pages.reused;
    const next = await pages.use(figure, always);
    expect(next.page).not.toBe(first);
    expect(next.nav, 'a new page is a full load').toBeUndefined();
    expect(opened).toHaveLength(2);
    expect(pages.reused, 'not drawn on a held page').toBe(reused);
  }

  it('on a failure: the figure threw', async () => {
    const { pages, opened } = pool(true);
    const first = await pages.use(figure, always);
    await expect(
      pages.use(failing(new Error('the page reported: nothing drawn')), always)
    ).rejects.toThrow('nothing drawn');
    await afterwards(pages, opened, first.page, 'failure');
  });

  it('on a failure: the figure timed out', async () => {
    const { pages, opened } = pool(true);
    const first = await pages.use(figure, always);
    await expect(pages.use(failing(timeout()), always)).rejects.toThrow('Timeout 45000ms');
    await afterwards(pages, opened, first.page, 'failure');
  });

  it('on a failure: the figure was drawn, with an error thrown in the page', async () => {
    const { pages, opened } = pool(true);
    const first = await pages.use(drawn([]), verdict);
    expect(pages.held, 'a clean figure leaves its page held').toBe(1);
    const second = await pages.use(drawn(['TypeError: something went wrong']), verdict);
    expect(second.page).toBe(first.page);
    expect(second.bytes, 'the figure is still answered').toBe('figure');
    await afterwards(pages, opened, first.page, 'failure');
  });

  it('not on console errors alone: the page is held, and the next figure moved (T015)', async () => {
    const { pages, opened } = pool(true);
    const first = await pages.use(drawn([]), verdict);
    const second = await pages.use(drawn([`${LOGGED}Missing graph data for node:  4 .`]), verdict);
    expect(second.page).toBe(first.page);
    expect(first.page.closed).toBe(false);
    expect(pages.held).toBe(1);
    const third = await pages.use(drawn([]), verdict);
    expect(third.page).toBe(first.page);
    expect(third.nav).toBeDefined();
    expect(opened).toHaveLength(1);
    expect(pages.replaced.failure).toBe(0);
  });

  it('on a failure: the page crashed while it was held', async () => {
    const { pages, opened } = pool(true);
    const first = await pages.use(figure, always);
    first.page.crashed = true;
    const next = await pages.use(figure, always);
    expect(next.page, 'drawn on another page, not failed on the dead one').not.toBe(first.page);
    expect(next.nav).toBeUndefined();
    expect(first.page.closed).toBe(true);
    expect(pages.replaced.failure).toBe(1);
    expect(opened).toHaveLength(2);
  });

  it('on a browser restart: every held page goes', async () => {
    const { pages, opened, open } = pool(true);
    const [one, two] = await Promise.all([pages.use(figure, always), pages.use(figure, always)]);
    expect(pages.held).toBe(2);
    await pages.replaceAll('browser');
    expect(one.page.closed && two.page.closed).toBe(true);
    expect(open()).toBe(0);
    expect(pages.held).toBe(0);
    expect(pages.replaced).toEqual({ failure: 0, browser: 2, count: 0, memory: 0, build: 0 });
    const next = await pages.use(figure, always);
    expect(next.nav, 'a new page is a full load').toBeUndefined();
    expect(opened).toHaveLength(3);
  });

  it('on a browser restart: a page drawn on while it happens is not held after', async () => {
    const { pages, opened } = pool(true);
    let restart = () => {};
    const during = pages.use(async (page, nav) => {
      await new Promise<void>((resolve) => (restart = resolve));
      return { page, nav };
    }, always);
    await new Promise((resolve) => setTimeout(resolve, 1));
    await pages.replaceAll('browser');
    restart();
    const { page } = await during;
    expect(page.closed).toBe(true);
    expect(pages.held).toBe(0);
    expect(pages.replaced.browser).toBe(1);
    const next = await pages.use(figure, always);
    expect(next.page).not.toBe(page);
    expect(opened).toHaveLength(2);
  });
});

describe("a failed figure's answer with held pages is today's (spec 018 US3, 2)", () => {
  // The service answers a failure from the error the figure threw (its status
  // and its message): the pool must hand that error on as it is, with reuse on
  // as with reuse off, whatever closing the page does.
  it.each([
    ['an error', () => new Error('the page reported: nothing drawn')],
    ['a timeout', timeout],
    ['an error with a status', () => Object.assign(new Error('no such pathway'), { status: 404 })],
  ])('rejects with the figure’s own error: %s', async (_, make) => {
    const error = make();
    const fresh = pool(false);
    const reused = pool(true);
    await reused.pages.use(figure, always);
    await expect(fresh.pages.use(failing(error), always)).rejects.toBe(error);
    await expect(reused.pages.use(failing(error), always)).rejects.toBe(error);
  });

  it('answers a figure with a browser problem with the figure, as today', async () => {
    const fresh = pool(false);
    const reused = pool(true);
    await reused.pages.use(drawn([]), verdict);
    const problems = ['TypeError: something went wrong', `${LOGGED}something went wrong`];
    const today = await fresh.pages.use(drawn(problems), verdict);
    const held = await reused.pages.use(drawn(problems), verdict);
    expect(held.nav, 'drawn on a held page').toBeDefined();
    expect({ ...held, page: undefined, nav: undefined }).toEqual({
      ...today,
      page: undefined,
      nav: undefined,
    });
  });
});

describe('replacing a held page by count, memory and build (spec 018 T007)', () => {
  it('by count: no page draws more than its figures, and the next is a full load', async () => {
    const { pages, opened } = pool(true, 1, { maxFigures: 3 });
    const drawn: { page: Stand; nav: string | undefined }[] = [];
    for (let at = 0; at < 7; at++) drawn.push(await pages.use(figure, always));
    const perPage = opened.map((page) => drawn.filter((one) => one.page === page).length);
    expect(perPage).toEqual([3, 3, 1]);
    expect(drawn.map((one) => one.nav === undefined)).toEqual([
      true,
      false,
      false,
      true,
      false,
      false,
      true,
    ]);
    expect(opened[0]?.closed && opened[1]?.closed).toBe(true);
    expect(pages.replaced.count).toBe(2);
  });

  it('by memory, past the ceiling: every page that drew cleanly is closed', async () => {
    let share = 0.4;
    const { pages, opened } = pool(true, 1, { memory: () => share, memoryBound: 0.5 });
    const first = await pages.use(figure, always);
    expect(pages.held).toBe(1);
    // A quarter of the way from the bound to the limit: 0.625.
    share = 0.63;
    const second = await pages.use(figure, always);
    expect(second.page).toBe(first.page);
    expect(first.page.closed).toBe(true);
    expect(pages.held).toBe(0);
    expect(pages.replaced.memory).toBe(1);
    // A page new to its first figure goes too, this close to the limit.
    const third = await pages.use(figure, always);
    expect(third.nav, 'a new page is a full load').toBeUndefined();
    expect(third.page.closed).toBe(true);
    expect(pages.replaced.memory).toBe(2);
    share = 0.4;
    const fourth = await pages.use(figure, always);
    expect(opened).toHaveLength(3);
    expect(fourth.page.closed).toBe(false);
    expect(pages.held).toBe(1);
  });

  it('by memory, past the bound: not a page new to its first figure (T015)', async () => {
    const { pages, opened } = pool(true, 1, { memory: () => 0.6, memoryBound: 0.5 });
    const first = await pages.use(figure, always);
    // T010's hour: every page replaced after its first figure, none held.
    expect(first.page.closed).toBe(false);
    expect(pages.held).toBe(1);
    // Its second: replaced.
    const second = await pages.use(figure, always);
    expect(second.page).toBe(first.page);
    expect(first.page.closed).toBe(true);
    expect(pages.replaced.memory).toBe(1);
    expect(opened).toHaveLength(1);
  });

  it('by memory, past the bound: one page in each round of figures (T015)', async () => {
    // Two pages drawn on at once, past the bound throughout.
    const { pages, opened } = pool(true, 2, { memory: () => 0.6, memoryBound: 0.5 });
    const closedAfter: number[] = [];
    for (let round = 0; round < 6; round++) {
      await Promise.all([pages.use(figure, always), pages.use(figure, always)]);
      closedAfter.push(pages.replaced.memory);
    }
    // Round 1: both new, both held. Then one goes in each round, never both:
    // T007's rule replaced both in every round, and held none.
    expect(closedAfter).toEqual([0, 1, 2, 3, 4, 5]);
    expect(pages.reused).toBe(6);
    expect(opened).toHaveLength(6);
  });

  /** A figure as the service draws one: a full load records the build the page loaded. */
  const loading =
    (build: string | null) =>
    async (page: Stand, nav: string | undefined): Promise<{ page: Stand; nav?: string }> => {
      await new Promise((resolve) => setTimeout(resolve, 1));
      if (nav === undefined) page.loaded = build;
      return { page, ...(nav === undefined ? {} : { nav }) };
    };

  it('by build: a held page of an older build is replaced before it draws', async () => {
    let site: string | null = 'main-OLD.js';
    const { pages, opened } = pool(true, 1, { siteBuild: async () => site });
    const first = await pages.use(loading('main-OLD.js'), always);
    const second = await pages.use(loading('main-OLD.js'), always);
    expect(second.page, 'the same build: moved').toBe(first.page);
    site = 'main-NEW.js';
    const third = await pages.use(loading('main-NEW.js'), always);
    expect(third.page).not.toBe(first.page);
    expect(third.nav, 'a new page is a full load').toBeUndefined();
    expect(first.page.closed).toBe(true);
    expect(pages.replaced.build).toBe(1);
    const fourth = await pages.use(loading('main-NEW.js'), always);
    expect(fourth.page, 'the new build: moved').toBe(third.page);
    expect(opened).toHaveLength(2);
  });

  it('by build: never on a guess, when either build cannot be read', async () => {
    const cases: [() => Promise<string | null>, string | null][] = [
      [async () => null, 'main-OLD.js'],
      [() => Promise.reject(new Error('the site is down')), 'main-OLD.js'],
      [async () => 'main-NEW.js', null],
    ];
    for (const [siteBuild, loaded] of cases) {
      const { pages, opened } = pool(true, 1, { siteBuild });
      await pages.use(loading(loaded), always);
      const next = await pages.use(loading(loaded), always);
      expect(next.nav, 'moved, not replaced').toBeDefined();
      expect(opened).toHaveLength(1);
      expect(pages.replaced.build).toBe(0);
    }
  });

  it('count, memory and build apply only to pages held, never with reuse off', async () => {
    const { pages, opened } = pool(false, 1, {
      maxFigures: 1,
      memory: () => 0.99,
      memoryBound: 0.5,
      siteBuild: async () => 'main-NEW.js',
    });
    for (let at = 0; at < 3; at++) await pages.use(loading('main-OLD.js'), always);
    expect(opened).toHaveLength(3);
    expect(pages.replaced).toEqual({ failure: 0, browser: 0, count: 0, memory: 0, build: 0 });
  });
});

describe('whether a page goes for memory (spec 018 T015)', () => {
  const at = (share: number, figures: number, since: number) =>
    memoryVerdict({ share, bound: 0.5, figures, since, pages: 4 });

  it('not at or under the bound', () => {
    expect(at(0.5, 50, Infinity)).toBe('hold');
  });

  it('past the ceiling, a quarter of the way from the bound to the limit: whatever it has drawn', () => {
    expect(at(0.63, 1, 0)).toBe('memory');
    expect(at(0.625, 1, 0), 'the ceiling itself is not past it').toBe('hold');
  });

  it('between them: once it has drawn more than one, and one page in each round of figures', () => {
    expect(at(0.6, 1, Infinity), 'new to its first figure').toBe('hold');
    expect(at(0.6, 2, Infinity)).toBe('memory');
    expect(at(0.6, 2, 3), 'three figures since the last went, of four drawn at once').toBe('hold');
    expect(at(0.6, 2, 4)).toBe('memory');
  });
});

describe("the service's memory (spec 018 T007, research R4)", () => {
  const files = (entries: Record<string, string>) => (file: string) => entries[file];

  it("is the share of its container's limit in use", () => {
    const container = files({ '/memory.max': '3221225472\n', '/memory.current': '1610612736\n' });
    expect(memoryShare(container)).toBe(0.5);
    expect(memoryShare(container, '/')).toBe(0.5);
  });

  it('leaves out the inactive file cache, which the kernel reclaims first (T019)', () => {
    // T010's re-run, as the container read it: 82% in use, 44% without the cache.
    const container = files({
      '/memory.max': '3221225472\n',
      '/memory.current': '2652569600\n',
      '/memory.stat':
        'anon 1175916544\nfile 1384828928\ninactive_file 1238282240\nactive_file 3784704\n',
    });
    expect(memoryShare(container)).toBeCloseTo(0.439, 3);
    // Only the nearest limit's own group is read for its cache.
    const unit = files({
      '/user.slice/render.service/memory.stat': 'inactive_file 900\n',
      '/user.slice/memory.max': '1000\n',
      '/user.slice/memory.current': '500\n',
      '/user.slice/memory.stat': 'active_file 400\ninactive_file 250\n',
    });
    expect(memoryShare(unit, '/user.slice/render.service')).toBe(0.25);
    // Never below nothing, should the two be read a moment apart.
    expect(
      memoryShare(
        files({
          '/memory.max': '1000\n',
          '/memory.current': '100\n',
          '/memory.stat': 'inactive_file 200\n',
        })
      )
    ).toBe(0);
  });

  it('is measured against the nearest limit, from its own group up', () => {
    const unit = files({
      '/user.slice/render.service/memory.max': 'max\n',
      '/user.slice/render.service/memory.current': '100\n',
      '/user.slice/memory.max': '1000\n',
      '/user.slice/memory.current': '250\n',
      '/memory.max': '4000\n',
      '/memory.current': '4000\n',
    });
    expect(memoryShare(unit, '/user.slice/render.service')).toBe(0.25);
  });

  it('has no share without a limit to read: none set, or no cgroup files', () => {
    expect(
      memoryShare(files({ '/memory.max': 'max\n', '/memory.current': '1000\n' }))
    ).toBeUndefined();
    expect(memoryShare(files({}), '/a/b')).toBeUndefined();
    expect(memoryShare(files({ '/memory.max': '1000\n' }))).toBeUndefined();
  });
});

describe("the site's build (spec 018 T007, research R3)", () => {
  it("is the render page's main script, named as the page names it", () => {
    const html =
      '<script type="text/javascript" src="https://cdn.example/npm/plugin@3/build/plugin.js"></script>' +
      '<script src="polyfills-ABC123.js" type="module"></script>' +
      '<script src="main-SE33KTT3.js" type="module"></script>';
    expect(buildIn(html)).toBe('main-SE33KTT3.js');
    expect(buildIn("<script src='/PathwayBrowser/main-X1.js?v=2'></script>")).toBe('main-X1.js');
    expect(buildIn('<script src="domain-main-X1.js"></script><p>main-X2.js</p>')).toBeNull();
  });

  it('names the stylesheet beside it, whose colours a script name does not show', () => {
    const page = (styles: string) =>
      `<link rel="stylesheet" href="${styles}" media="print" onload="this.media='all'">` +
      `<noscript><link rel="stylesheet" href="${styles}"></noscript>` +
      '<script src="main-V3Q3PHGE.js" type="module"></script>';
    expect(buildIn(page('styles-Y6RZ6DMA.css'))).toBe('main-V3Q3PHGE.js styles-Y6RZ6DMA.css');
    // a deploy that changed only the colours is a different build
    expect(buildIn(page('styles-NEW00000.css'))).not.toBe(buildIn(page('styles-Y6RZ6DMA.css')));
    // another stylesheet is not the site's
    expect(buildIn(page('https://fonts.example/css2.css'))).toBe('main-V3Q3PHGE.js');
  });

  it('is read at most once a minute, and again after a minute', async () => {
    let clock = 0;
    let reads = 0;
    const build = atMostEvery(
      60_000,
      async () => `main-${++reads}.js`,
      () => clock
    );
    expect(await build()).toBe('main-1.js');
    clock = 59_999;
    expect(await build()).toBe('main-1.js');
    expect(reads).toBe(1);
    clock = 60_000;
    expect(await build()).toBe('main-2.js');
    expect(reads).toBe(2);
  });

  it('is null when it cannot be read, and read again a minute later', async () => {
    let clock = 0;
    let fail = true;
    const build = atMostEvery(
      60_000,
      async () => {
        if (fail) throw new Error('the site is down');
        return 'main-A.js';
      },
      () => clock
    );
    expect(await build()).toBeNull();
    fail = false;
    expect(await build(), 'not asked again within the minute').toBeNull();
    clock = 60_000;
    expect(await build()).toBe('main-A.js');
  });
});

describe('what /health says of the pages (spec 018 T008, contracts/health.md)', () => {
  it('counts the pages held now, the figures drawn on held pages, and replacements by why', async () => {
    const { pages } = pool(true, 2, { maxFigures: 2 });
    // Two at once: two pages opened, both held.
    await Promise.all([pages.use(figure, always), pages.use(figure, always)]);
    // A held page's second figure, its last: reused, then replaced by count.
    await pages.use(figure, always);
    // The other held page fails its figure: replaced, and not counted as reused.
    await expect(pages.use(failing(new Error('nothing drawn')), always)).rejects.toThrow();
    // Two at once again: two new pages held.
    await Promise.all([pages.use(figure, always), pages.use(figure, always)]);

    expect(pages.health()).toEqual({
      reused: 1,
      pages: 2,
      replaced: { failure: 1, browser: 0, count: 1, memory: 0, build: 0 },
    });

    await pages.replaceAll('browser');
    expect(pages.health(), 'read when asked, not when made').toEqual({
      reused: 1,
      pages: 0,
      replaced: { failure: 1, browser: 2, count: 1, memory: 0, build: 0 },
    });
  });
});
