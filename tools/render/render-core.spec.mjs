import { describe, expect, it } from 'vitest';
import { render } from './render-core.mjs';

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

  it('draws the diagram when no layout is asked for', async () => {
    const url = await addressFor({});
    expect(url.searchParams.has('layout')).toBe(false);
    expect(url.pathname).toBe('/PathwayBrowser/render/R-HSA-6805479');
  });
});
