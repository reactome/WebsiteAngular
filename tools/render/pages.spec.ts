import { describe, expect, it } from 'vitest';
import { Pages, verdict, type Verdict } from './pages.ts';

/** A stand-in page: which it is, whether it is closed, and whether it was opened to be held. */
interface Stand {
  id: number;
  held: boolean;
  closed: boolean;
  crashed: boolean;
  close(): Promise<void>;
  alive(): boolean;
}

/** A pool over stand-in pages, recording every page it opens. */
function pool(reuse: boolean, max = 2) {
  const opened: Stand[] = [];
  const pages = new Pages<Stand>({
    reuse,
    max,
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
    expect(pages.replaced, 'nothing went wrong').toEqual({ failure: 0, browser: 0 });
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
  it('holds a page that drew cleanly, and replaces one that reported a browser problem', () => {
    expect(verdict({ movable: true, problems: [] })).toBe('hold');
    expect(verdict({ movable: true, problems: ['TypeError: x is undefined'] })).toBe('failure');
    expect(verdict({ movable: true, problems: ['console: Failed to load resource'] })).toBe(
      'failure'
    );
  });

  it('closes, without counting, a page that no longer holds the render page', () => {
    expect(verdict({ movable: false, problems: [] })).toBe('spent');
    // A PDF whose figure also reported a problem is a failure all the same.
    expect(verdict({ movable: false, problems: ['console: boom'] })).toBe('failure');
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

  it('on a failure: the figure was drawn, with a browser problem', async () => {
    const { pages, opened } = pool(true);
    const first = await pages.use(drawn([]), verdict);
    expect(pages.held, 'a clean figure leaves its page held').toBe(1);
    const second = await pages.use(drawn(['console: something went wrong']), verdict);
    expect(second.page).toBe(first.page);
    expect(second.bytes, 'the figure is still answered').toBe('figure');
    await afterwards(pages, opened, first.page, 'failure');
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
    expect(pages.replaced).toEqual({ failure: 0, browser: 2 });
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
    const problems = ['console: something went wrong'];
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
