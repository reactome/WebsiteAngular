import { describe, expect, it } from 'vitest';
import { Pages } from './pages.ts';

/** A stand-in page: which it is, whether it is closed, and whether it was opened to be held. */
interface Stand {
  id: number;
  held: boolean;
  closed: boolean;
  close(): Promise<void>;
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
        async close() {
          this.closed = true;
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
const always = () => true;

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
    const first = await pages.use(figure, () => false);
    expect(first.page.closed).toBe(true);
    expect(pages.held).toBe(0);
  });

  it('let go of every held page when asked', async () => {
    const { pages, open } = pool(true);
    await Promise.all([pages.use(figure, always), pages.use(figure, always)]);
    expect(open()).toBe(2);
    await pages.closeAll();
    expect(open()).toBe(0);
    expect(pages.held).toBe(0);
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
