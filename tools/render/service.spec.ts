// @vitest-environment node
//
// The first test that executes a service request handler.
//
// That it is the first is the point. `repeated` was used in the handler and
// never imported, so every render 500'd with a ReferenceError -- and types,
// lint, dead-code, format and 380 unit tests all reported green, because
// nothing in the suite had ever run one of these requests. Linting tools/ now
// catches an undefined name; this catches a handler that throws for any other
// reason.
//
// No browser and no network: every assertion below is answered before the
// service would reach for either.
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { app, cacheKey, httpError, isModule, publicMessage, statusOf } from './service.ts';

let base: string;
let server: Server;

/** The fields of the service's JSON answers these tests read: /health's, and a refusal's. */
interface Answer {
  ok?: boolean;
  build?: string;
  modules?: number;
  error?: string;
  canonical?: string;
  formats?: string[];
}
const json = async (response: Response) => (await response.json()) as Answer;

beforeAll(async () => {
  await new Promise<void>((resolve) => {
    server = app.listen(0, '127.0.0.1', () => resolve());
  });
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => new Promise((resolve) => server.close(resolve)));

describe('/health', () => {
  it('answers, which is the assertion that was missing', async () => {
    const response = await fetch(`${base}/health`);
    expect(response.status).toBe(200);
    expect((await json(response)).ok).toBe(true);
  });

  it('says which code is running, so a stale container can be spotted', async () => {
    // The image bakes the modules in, so building is a separate act from
    // merging. Without this the only way to tell what a container was running
    // was to read the source on disk -- the CLI's copy, which always agrees
    // with you.
    const body = await json(await fetch(`${base}/health`));
    expect(body.build, 'a fingerprint of its own modules').toMatch(/^[0-9a-f]{12}$/);
    expect(body.modules, 'the number of modules hashed').toBeGreaterThan(1);
  });
});

describe('the cache key', () => {
  const figure = {
    pathway: 'R-HSA-69620',
    format: 'svg',
    token: '',
    scale: 2,
    subpathways: true,
    delay: 1000,
    maxSize: 0,
    dark: false,
    select: '',
    layout: '',
    highlight: '',
  };

  it('keeps fields apart, which joining them with spaces did not', () => {
    // Joined with spaces, layout 'a b' and layout 'a' with highlight 'b' were
    // one string -- one key -- so either figure could be served for the other.
    expect(cacheKey({ ...figure, layout: 'a b' })).not.toBe(
      cacheKey({ ...figure, layout: 'a', highlight: 'b' })
    );
  });

  it("tells species' overviews apart, and leaves every figure without one where it was", () => {
    const overview = { ...figure, pathway: '' };
    expect(cacheKey({ ...overview, species: '10090' })).not.toBe(cacheKey(overview));
    expect(cacheKey({ ...overview, species: '' })).toBe(cacheKey(overview));
  });
});

describe('the request handler runs at all', () => {
  it('refuses an unknown parameter instead of throwing', async () => {
    const response = await fetch(`${base}/render/R-HSA-109606.png?bogus=1`);
    expect(response.status).toBe(400);
    const body = await json(response);
    expect(body.error).toContain('bogus');
    expect(body.canonical).toBe('/render/R-HSA-109606.png');
  });

  it('names a bracketed parameter by its name, as the extended query parser reads it', async () => {
    // Express 5's default parser keeps `x[y]` as one key; this service keeps
    // Express 4's, which reads it as `x` holding `{ y }` (spec 014 R7).
    const response = await fetch(`${base}/render/R-HSA-109606.png?x[y]=1`);
    expect(response.status).toBe(400);
    expect(((await response.json()) as { error: string }).error).toBe('unknown parameter "x"');
  });

  it('refuses a repeated parameter, the case that was throwing', async () => {
    const response = await fetch(`${base}/render/R-HSA-109606.png?token=a&token=b`);
    expect(response.status).toBe(400);
    expect((await json(response)).error).toContain('more than once');
  });

  it('refuses a bracketed token, which drew the figure without its overlay', async () => {
    const response = await fetch(`${base}/render/R-HSA-109606.png?token[a]=ABC&scale=1`);
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: '"token" given with brackets; send it as token=…',
      canonical: '/render/R-HSA-109606.png?scale=1',
    });
  });

  it('refuses a value outside its range', async () => {
    const response = await fetch(`${base}/render/R-HSA-109606.png?scale=4`);
    expect(response.status).toBe(400);
    expect((await json(response)).error).toContain('scale');
  });

  it('refuses select and highlight together, which ask for two different figures', async () => {
    // select frames the figure on one event; highlight marks events on the whole
    // diagram, as Java's exporter draws a selection.
    const response = await fetch(
      `${base}/render/R-HSA-69620.svg?select=R-HSA-69608&highlight=R-HSA-69608`
    );
    expect(response.status).toBe(400);
    expect((await json(response)).error).toContain(
      '"select" and "highlight" cannot be used together'
    );
  });

  it('refuses a species anywhere but the genome-wide view, and one that is not a taxId', async () => {
    const onPathway = await fetch(`${base}/render/R-HSA-69620.svg?species=10090`);
    expect([onPathway.status, (await json(onPathway)).error]).toEqual([
      400,
      '"species" applies only to genome-wide; a pathway is its own species',
    ]);
    const byName = await fetch(`${base}/render/genome-wide.svg?species=Mus%20musculus`);
    const refused = await json(byName);
    expect([byName.status, refused.error]).toEqual([400, '"species" must be a taxId, e.g. 9606']);
    // No suggestion: without the species it would be the default species'
    // overview, a figure of the wrong species.
    expect(refused.canonical).toBe(undefined);
    for (const species of ['abc9606', '9606x', '09606']) {
      const response = await fetch(`${base}/render/genome-wide.svg?species=${species}`);
      expect([species, response.status]).toEqual([species, 400]);
    }
  });

  it('refuses a format it cannot draw', async () => {
    const response = await fetch(`${base}/render/R-HSA-109606.tiff`);
    expect(response.status).toBe(400);
    expect((await json(response)).formats).toContain('jpeg');
  });
});

describe('isModule, what /health hashes', () => {
  it('takes modules, .mjs or .ts, and no specs or notes (spec 013)', () => {
    expect(
      [
        'service.mjs',
        'params.ts',
        'service.spec.mjs',
        'params.spec.ts',
        'page.d.ts',
        'README.md',
      ].filter(isModule)
    ).toEqual(['service.mjs', 'params.ts']);
  });
});

// What replaced `error.status || 500` (spec 013): the status a failed render
// answers with (review of #552).
describe('publicMessage, what a failed render tells the caller', () => {
  it("keeps the message's first line, not the page's stack behind it", () => {
    // As Playwright reports a failure inside the page: the page's stack,
    // naming its bundles and the address the service reaches the site on.
    const failure = new Error(
      'page.evaluate: Error: this view cannot export PNG yet\n' +
        '    at i.exportRaster (http://internal-host:4200/chunk-ABC.js:1:2)\n' +
        '    at Object.png (http://internal-host:4200/chunk-ABC.js:3:4)'
    );
    expect(publicMessage(failure)).toBe('page.evaluate: Error: this view cannot export PNG yet');
    expect(publicMessage(httpError(404, 'no such pathway: X'))).toBe('no such pathway: X');
    expect(publicMessage('a string')).toBe('a string');
  });
});

describe('statusOf, what a failed render answers with', () => {
  it('answers with the status the failure was given, and 500 for any other', () => {
    expect(
      [
        httpError(404, 'no such pathway'),
        httpError(400, 'bad layout'),
        httpError(503, 'saturated'),
        new Error('the browser crashed'),
        Object.assign(new Error('odd'), { status: '404' }),
        null,
        'a string thrown',
      ].map(statusOf)
    ).toEqual([404, 400, 503, 500, 500, 500, 500]);
  });
});
