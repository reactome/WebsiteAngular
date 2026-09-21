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
import { app } from './service.mjs';

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

  it('refuses a format it cannot draw', async () => {
    const response = await fetch(`${base}/render/R-HSA-109606.tiff`);
    expect(response.status).toBe(400);
    expect((await response.json()).formats).toContain('jpeg');
  });
});
