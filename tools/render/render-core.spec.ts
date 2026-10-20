import { describe, expect, it } from 'vitest';
import { render } from './render-core.ts';

// What address the render page is opened at, read off a stand-in page that
// stops at the first navigation. The address is the whole contract between
// this and the page: a parameter that does not reach it changes nothing.
async function addressFor(options) {
  let opened = '';
  const page = {
    on() {},
    off() {},
    async goto(url) {
      opened = url;
      throw new Error('stop here');
    },
  };
  await render(page, { base: 'http://site', pathway: 'R-HSA-6805479', ...options }).catch(
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
    const page = (drew) => ({
      on() {},
      off() {},
      async goto() {},
      async waitForSelector() {},
      async evaluate() {
        return { ready: true, view: 'reacfoam', ...(drew ? { species: drew } : {}) };
      },
    });
    await expect(
      render(page(undefined), { base: 'http://site', species: '10090' })
    ).rejects.toThrow('asked for species 10090, the page drew one it did not name');
    await expect(render(page('9606'), { base: 'http://site', species: '10090' })).rejects.toThrow(
      'asked for species 10090, the page drew 9606'
    );
  });
});
