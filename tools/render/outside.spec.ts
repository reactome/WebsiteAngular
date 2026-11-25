// @vitest-environment node
//
// The render page's requests to other hosts (spec 018 T018): a ChEBI structure
// answered with nothing, anything else fetched once and answered from memory.
import { describe, expect, it } from 'vitest';
import { CHEBI_STRUCTURE, Outside, type OutsideRoute } from './outside.ts';

const SITE = 'http://host.docker.internal:4200';
const FONT = 'https://fonts.gstatic.com/s/roboto/v1/a.woff2';
const STRUCTURE = 'https://www.ebi.ac.uk/chebi/backend/api/public/compound/15422/structure/';

/** A route's stand-in: what it was answered with, and whether it went on to its host. */
function route(url: string, fetched: () => Promise<Buffer>, method = 'GET', status = 200) {
  const seen: { fulfilled?: Parameters<OutsideRoute['fulfill']>[0]; continued: boolean } = {
    continued: false,
  };
  const stand: OutsideRoute = {
    request: () => ({ url: () => url, method: () => method }),
    fulfill: async (answer) => {
      seen.fulfilled = answer;
    },
    continue: async () => {
      seen.continued = true;
    },
    fetch: async () => {
      const body = await fetched();
      return {
        status: () => status,
        headers: () => ({
          'content-type': 'font/woff2',
          'access-control-allow-origin': '*',
          'content-encoding': 'br',
          'content-length': '3',
        }),
        body: async () => body,
      };
    },
  };
  return { stand, seen };
}

describe('Outside (spec 018 T018)', () => {
  it("takes every host but the site's and the download site's", () => {
    const outside = new Outside(SITE);
    const takes = (url: string) => outside.matches(new URL(url));
    expect(takes(`${SITE}/PathwayBrowser/render/R-HSA-69620`)).toBe(false);
    expect(takes('https://download.reactome.org/98/diagram/R-HSA-69620.json')).toBe(false);
    expect(takes('data:image/png;base64,AA==')).toBe(false);
    expect(takes(FONT)).toBe(true);
    expect(takes(STRUCTURE)).toBe(true);
    expect(takes('https://cdn.jsdelivr.net/npm/pdbe-molstar@3.3.0/build/a.js')).toBe(true);
  });

  it('answers a ChEBI structure with nothing, never asking ChEBI', async () => {
    const outside = new Outside(SITE);
    let asked = 0;
    const { stand, seen } = route(STRUCTURE, async () => {
      asked++;
      return Buffer.from('<svg/>');
    });
    expect(CHEBI_STRUCTURE.test(STRUCTURE)).toBe(true);
    await outside.answer(stand);
    expect(seen.fulfilled).toEqual({ status: 200, contentType: 'text/plain', body: '' });
    expect(asked).toBe(0);
    expect(outside.health()).toEqual({ answered: 1, fetched: 0 });
  });

  it('fetches anything else once, and answers it from memory after, decoded', async () => {
    const outside = new Outside(SITE);
    let asked = 0;
    const font = () => {
      asked++;
      return Promise.resolve(Buffer.from('abc'));
    };
    const answers = [route(FONT, font), route(FONT, font), route(FONT, font)];
    await Promise.all(answers.map(({ stand }) => outside.answer(stand)));
    expect(asked).toBe(1);
    for (const { seen } of answers) {
      expect(seen.continued).toBe(false);
      expect(seen.fulfilled?.body.toString()).toBe('abc');
      // decoded when fetched: the encoding and length of the bytes sent are not these
      expect(seen.fulfilled?.headers).toEqual({
        'content-type': 'font/woff2',
        'access-control-allow-origin': '*',
      });
    }
    expect(outside.health()).toEqual({ answered: 2, fetched: 1 });
  });

  it('keeps no failed fetch: that request goes on to its host, and the next asks again', async () => {
    const outside = new Outside(SITE);
    const failing = route(FONT, () => Promise.reject(new Error('offline')));
    await outside.answer(failing.stand);
    expect(failing.seen.continued).toBe(true);
    const next = route(FONT, () => Promise.resolve(Buffer.from('abc')));
    await outside.answer(next.stand);
    expect(next.seen.fulfilled?.body.toString()).toBe('abc');
    expect(outside.health()).toEqual({ answered: 0, fetched: 2 });
  });

  it('keeps no error answer: it is passed on, and the next asks again', async () => {
    // One 503 from the font's host, kept, would have drawn every later figure
    // of a release's run in the fallback font, with nothing said.
    const outside = new Outside(SITE);
    const failing = route(FONT, () => Promise.resolve(Buffer.from('busy')), 'GET', 503);
    await outside.answer(failing.stand);
    expect(failing.seen.fulfilled?.status).toBe(503);
    const next = route(FONT, () => Promise.resolve(Buffer.from('abc')));
    await outside.answer(next.stand);
    expect(next.seen.fulfilled?.status).toBe(200);
    expect(next.seen.fulfilled?.body.toString()).toBe('abc');
    expect(outside.health()).toEqual({ answered: 0, fetched: 2 });
  });

  it('sends anything but a GET on as it is', async () => {
    const outside = new Outside(SITE);
    const posted = route('https://example.org/log', () => Promise.resolve(Buffer.from('')), 'POST');
    await outside.answer(posted.stand);
    expect(posted.seen.continued).toBe(true);
    expect(posted.seen.fulfilled).toBeUndefined();
  });
});
