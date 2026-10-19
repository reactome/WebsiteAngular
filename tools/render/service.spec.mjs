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
import { app, cacheKey, isModule } from './service.mjs';

let base;
let server;

beforeAll(async () => {
  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  base = `http://127.0.0.1:${server.address().port}`;
});

afterAll(() => new Promise((resolve) => server.close(resolve)));

describe('/health', () => {
  it('answers, which is the assertion that was missing', async () => {
    const response = await fetch(`${base}/health`);
    expect(response.status).toBe(200);
    expect((await response.json()).ok).toBe(true);
  });

  it('says which code is running, so a stale container can be spotted', async () => {
    // The image bakes the modules in, so building is a separate act from
    // merging. Without this the only way to tell what a container was running
    // was to read the source on disk -- the CLI's copy, which always agrees
    // with you.
    const body = await (await fetch(`${base}/health`)).json();
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
    const body = await response.json();
    expect(body.error).toContain('bogus');
    expect(body.canonical).toBe('/render/R-HSA-109606.png');
  });

  it('refuses a repeated parameter, the case that was throwing', async () => {
    const response = await fetch(`${base}/render/R-HSA-109606.png?token=a&token=b`);
    expect(response.status).toBe(400);
    expect((await response.json()).error).toContain('more than once');
  });

  it('refuses a value outside its range', async () => {
    const response = await fetch(`${base}/render/R-HSA-109606.png?scale=4`);
    expect(response.status).toBe(400);
    expect((await response.json()).error).toContain('scale');
  });

  it('refuses select and highlight together, which ask for two different figures', async () => {
    // select frames the figure on one event; highlight marks events on the whole
    // diagram, as Java's exporter draws a selection.
    const response = await fetch(
      `${base}/render/R-HSA-69620.svg?select=R-HSA-69608&highlight=R-HSA-69608`
    );
    expect(response.status).toBe(400);
    expect((await response.json()).error).toContain(
      '"select" and "highlight" cannot be used together'
    );
  });

  it('refuses a species anywhere but the genome-wide view, and one that is not a taxId', async () => {
    const onPathway = await fetch(`${base}/render/R-HSA-69620.svg?species=10090`);
    expect([onPathway.status, (await onPathway.json()).error]).toEqual([
      400,
      '"species" applies only to genome-wide; a pathway is its own species',
    ]);
    const byName = await fetch(`${base}/render/genome-wide.svg?species=Mus%20musculus`);
    const refused = await byName.json();
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
    expect((await response.json()).formats).toContain('jpeg');
  });
});

describe('isModule, what /health hashes', () => {
  it('takes modules, .mjs or .ts, and no specs or notes (spec 013)', () => {
    expect(
      ['service.mjs', 'params.ts', 'service.spec.mjs', 'params.spec.ts', 'README.md'].filter(
        isModule
      )
    ).toEqual(['service.mjs', 'params.ts']);
  });
});
