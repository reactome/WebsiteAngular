import type { Page, Route } from '@playwright/test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { render } from './render-core.ts';

// A stand-in page: only what render reaches before the test stops it.
const stand = (page: object) => page as Page;

// What address the render page is opened at, read off a stand-in page that
// stops at the first navigation. The address is the whole contract between
// this and the page: a parameter that does not reach it changes nothing.
async function addressFor(options: Partial<Parameters<typeof render>[1]> = {}) {
  let opened = '';
  const page = {
    on() {},
    off() {},
    async goto(url: string) {
      opened = url;
      throw new Error('stop here');
    },
  };
  await render(stand(page), { base: 'http://site', pathway: 'R-HSA-6805479', ...options }).catch(
    () => undefined
  );
  return new URL(opened);
}

describe('the render page address', () => {
  it("asks for a reaction's own layout when told to", async () => {
    // Renamed from `view` on one side only (#277), so the page never heard it:
    // every reaction figure came out as the whole pathway diagram around it.
    const url = await addressFor({ layout: 'reaction' });
    expect(url.searchParams.get('layout')).toBe('reaction');
  });

  it('passes the events to highlight, as one comma-separated list', async () => {
    // Java's exporter draws a subpathway as its parent's diagram with the
    // subpathway's reactions selected: sixteen of them for one.
    const url = await addressFor({ highlight: 'R-HSA-69608,R-HSA-69600' });
    expect(url.searchParams.get('highlight')).toBe('R-HSA-69608,R-HSA-69600');
    expect(url.searchParams.has('select')).toBe(false);
  });

  it('draws the diagram when no layout is asked for', async () => {
    const url = await addressFor({});
    expect(url.searchParams.has('layout')).toBe(false);
    expect(url.pathname).toBe('/PathwayBrowser/render/R-HSA-6805479');
  });

  it("names the overview's species, and leaves it out when none is asked for", async () => {
    const overview = await addressFor({ pathway: '', species: '10090' });
    expect(overview.pathname).toBe('/PathwayBrowser/render');
    expect(overview.searchParams.get('species')).toBe('10090');
    expect((await addressFor({ pathway: '' })).searchParams.has('species')).toBe(false);
  });
});

describe('a figure of another species', () => {
  it('is refused, not handed back as the one asked for', async () => {
    // What a site too old to know `species` does: it draws the default
    // species and reports none, with every sign of success.
    const page = (drew: string | undefined) => ({
      on() {},
      off() {},
      async goto() {},
      async waitForSelector() {},
      async evaluate() {
        return { ready: true, view: 'reacfoam', ...(drew ? { species: drew } : {}) };
      },
    });
    await expect(
      render(stand(page(undefined)), { base: 'http://site', species: '10090' })
    ).rejects.toThrow('asked for species 10090, the page drew one it did not name');
    await expect(
      render(stand(page('9606')), { base: 'http://site', species: '10090' })
    ).rejects.toThrow('asked for species 10090, the page drew 9606');
  });
});

describe("the release's files", () => {
  // A stand-in page that records its routes and stops at the first navigation.
  function routed() {
    const routes: { matcher: (url: URL) => boolean; handler: (route: Route) => Promise<void> }[] =
      [];
    let seen: typeof routes = [];
    const page = {
      on() {},
      off() {},
      async route(matcher: (url: URL) => boolean, handler: (route: Route) => Promise<void>) {
        routes.push({ matcher, handler });
      },
      async unroute(matcher: unknown, handler: unknown) {
        const i = routes.findIndex((r) => r.matcher === matcher && r.handler === handler);
        if (i >= 0) routes.splice(i, 1);
      },
      async goto() {
        seen = [...routes];
        throw new Error('stop here');
      },
    };
    return { page, routes, seen: () => seen };
  }

  it('are read from the folder while the page draws, and the route removed after', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'render-core-files-'));
    try {
      await mkdir(path.join(root, '98', 'diagram'), { recursive: true });
      await writeFile(path.join(root, '98', 'diagram', 'R-HSA-1.json'), '{"x":1}');
      const { page, routes, seen } = routed();
      await render(stand(page), { base: 'http://site', pathway: 'R-HSA-1', files: root }).catch(
        () => undefined
      );
      const [only] = seen();
      expect(seen()).toHaveLength(1);
      expect(only?.matcher(new URL('https://download.reactome.org/98/diagram/R-HSA-1.json'))).toBe(
        true
      );
      expect(only?.matcher(new URL('http://site/ContentService/data/database/version'))).toBe(
        false
      );
      const fulfilled: unknown[] = [];
      const route = (url: string) =>
        ({
          request: () => ({ url: () => url }),
          fulfill: async (answer: unknown) => void fulfilled.push(answer),
          continue: async () => void fulfilled.push('continued'),
        }) as unknown as Route;
      await only?.handler(route('https://download.reactome.org/98/diagram/R-HSA-1.json'));
      await only?.handler(route('https://download.reactome.org/98/diagram/R-HSA-2.json'));
      expect(fulfilled).toMatchObject([
        { status: 200, contentType: 'application/json' },
        { status: 404 },
      ]);
      expect(String((fulfilled[0] as { body: Buffer }).body)).toBe('{"x":1}');
      expect(routes).toHaveLength(0);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('a request answered after its render has ended is said, never thrown', async () => {
    // Playwright runs a route's handler itself: a rejection from it is unhandled and ends
    // the service, as a render that timed out while its file was being read once did.
    const root = await mkdtemp(path.join(tmpdir(), 'render-core-files-'));
    try {
      await mkdir(path.join(root, '98', 'diagram'), { recursive: true });
      await writeFile(path.join(root, '98', 'diagram', 'R-HSA-1.json'), '{"x":1}');
      const { page, seen } = routed();
      await render(stand(page), { base: 'http://site', pathway: 'R-HSA-1', files: root }).catch(
        () => undefined
      );
      const [only] = seen();
      const handled = {
        request: () => ({ url: () => 'https://download.reactome.org/98/diagram/R-HSA-1.json' }),
        fulfill: () => Promise.reject(new Error('route.fulfill: Route is already handled!')),
      } as unknown as Route;
      await expect(only?.handler(handled)).resolves.toBeUndefined();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('are left to the download site when no folder is given', async () => {
    const { page, seen } = routed();
    await render(stand(page), { base: 'http://site', pathway: 'R-HSA-1' }).catch(() => undefined);
    expect(seen()).toHaveLength(0);
  });
});
