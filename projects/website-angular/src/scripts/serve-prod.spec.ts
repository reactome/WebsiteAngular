import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { createServer as createHttpServer, type Server } from 'node:http';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

// The express server that serves beta, which had no test at all: the e2e suite
// starts `ng serve` instead, so nothing exercised the thing real users hit.
//
// Its behaviours are all edge cases, which is exactly why they need pinning: the
// catch-all that makes client-side routing work, the 503 that replaced an ENOENT
// stack trace during a rebuild, and the fact that a missing asset comes back as
// the application's own HTML with a 200 on it. That last one is not a bug -- a
// single-page app cannot tell a bad asset path from a route -- but it is how the
// broken figures went unnoticed, and a check that only looks at status codes will
// call this server healthy while it serves HTML for every image on the site.

const SCRIPT = path.join(process.cwd(), 'projects/website-angular/src/scripts/serve-prod.js');
const INDEX_MARKER = '<title>test index</title>';

/** A port nothing else is on, so this can run beside a real dev server. */
async function freePort() {
  return await new Promise<number>((resolve, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      probe.close(() => resolve(port));
    });
  });
}

async function waitForServer(url: string, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      await fetch(url);
      return true;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
  }
  return false;
}

describe('serve-prod', () => {
  let dist = '';
  let base = '';
  let server: ChildProcess | undefined;

  beforeAll(async () => {
    dist = await mkdtemp(path.join(tmpdir(), 'serve-prod-'));
    await writeFile(path.join(dist, 'index.html'), `<!doctype html>${INDEX_MARKER}`, 'utf8');
    await mkdir(path.join(dist, 'assets'), { recursive: true });
    await writeFile(path.join(dist, 'assets', 'thing.txt'), 'an asset', 'utf8');

    const port = await freePort();
    base = `http://127.0.0.1:${port}`;
    server = spawn('node', [SCRIPT], {
      env: {
        ...process.env,
        DIST_DIR: dist,
        PORT: String(port),
        HOST: '127.0.0.1',
        // Pointed at a closed port on purpose. On a developer's box these
        // services are genuinely running, so without this the suite would
        // assert "down" and pass only where nothing is deployed — green in CI,
        // red locally, for a reason that has nothing to do with the code.
        HEALTH_CONTENT_NODE: 'http://127.0.0.1:9/health',
        HEALTH_RENDER: 'http://127.0.0.1:9/health',
        HEALTH_MCP: 'http://127.0.0.1:9/health',
      },
      stdio: 'ignore',
    });

    expect(await waitForServer(base), 'the server came up').toBe(true);
  }, 40_000);

  afterAll(async () => {
    server?.kill('SIGTERM');
    if (dist) await rm(dist, { recursive: true, force: true });
  });

  /**
   * The health route reports the services behind this one, and this suite runs
   * with none of them up — which is the case worth pinning. Every deployment
   * fault on this box has been something running a version from before the
   * merge with nothing saying so, and a health check that fell over when a
   * sibling was down would be reporting the estate under the name of the site.
   */
  it('reports each service, and says which are down', async () => {
    const body = await (await fetch(base + '/health')).json();
    expect(Object.keys(body.services)).toEqual(
      expect.arrayContaining(['content-node', 'render', 'mcp'])
    );
    // Nothing is running in this suite, so every one of them is down and each
    // says so on its own rather than collapsing into a single failure.
    for (const [name, state] of Object.entries(body.services as Record<string, { up: boolean }>)) {
      expect(state.up, `${name} should report its own state`).toBe(false);
    }
  });

  it('stays ok when a service behind it is down', async () => {
    // `ok` is the site's answer, not the estate's. The site renders without the
    // render service; telling a monitor otherwise pages somebody for the wrong
    // thing, and what is actually wrong is named in `services`.
    const body = await (await fetch(base + '/health')).json();
    expect(body.ok).toBe(true);
    expect(body.bundle === null || typeof body.bundle === 'string').toBe(true);
  });

  it('serves the build at the root', async () => {
    const response = await fetch(base + '/');
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toMatch(/text\/html/);
    expect(await response.text()).toContain(INDEX_MARKER);
  });

  it('serves a real asset as itself', async () => {
    const response = await fetch(base + '/assets/thing.txt');
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toMatch(/text\/plain/);
    expect(await response.text()).toBe('an asset');
  });

  it('answers an application route with the application', async () => {
    // Client-side routing: /about/news is not a file, and has to come back as
    // index.html or a deep link breaks on refresh.
    const response = await fetch(base + '/about/news');
    expect(response.status).toBe(200);
    expect(await response.text()).toContain(INDEX_MARKER);
  });

  it('answers a missing asset with HTML, which is why status alone proves nothing', async () => {
    // Pinned deliberately. This is unavoidable in a single-page app, and it is
    // the reason every figure on the site could 200 while being broken: a link
    // checker sees 200 and moves on. Anything checking assets has to look at the
    // content type too.
    const response = await fetch(base + '/figures/does-not-exist.png');
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toMatch(/text\/html/);
  });

  it('does not advertise what it is', async () => {
    const response = await fetch(base + '/');
    expect(response.headers.get('x-powered-by')).toBeNull();
  });

  it('says the build is being written rather than showing a stack trace', async () => {
    // `ng build --watch` empties the output directory for a few seconds. The
    // request that lands in that window used to get express's ENOENT trace,
    // which reads like the site is broken rather than busy.
    await rm(path.join(dist, 'index.html'));
    try {
      const response = await fetch(base + '/');
      expect(response.status).toBe(503);
      expect(response.headers.get('retry-after')).toBe('5');
      const body = await response.text();
      expect(body).toContain('Rebuilding');
      expect(body, 'the page refreshes itself so nobody sits on F5').toContain('http-equiv');
    } finally {
      await writeFile(path.join(dist, 'index.html'), `<!doctype html>${INDEX_MARKER}`, 'utf8');
    }
  });
});

// The two API roots. Opened directly, they used to reach Tomcat's legacy page,
// wrapped in a copy of the old reactome.org header whose menu points at pages
// this site does not have (curator review, item 1g). The bare roots are this
// site's API page now; everything under them is still the service.
describe('serve-prod and the API roots', () => {
  let dist = '';
  let base = '';
  let server: ChildProcess | undefined;
  let backend: Server | undefined;
  const reached: string[] = [];

  beforeAll(async () => {
    dist = await mkdtemp(path.join(tmpdir(), 'serve-prod-api-'));
    await writeFile(path.join(dist, 'index.html'), `<!doctype html>${INDEX_MARKER}`, 'utf8');

    const backendPort = await freePort();
    const upstream = createHttpServer((req, res) => {
      reached.push(req.url ?? '');
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end(`backend ${req.url}`);
    });
    backend = upstream;
    await new Promise<void>((resolve) => upstream.listen(backendPort, '127.0.0.1', resolve));

    const port = await freePort();
    base = `http://127.0.0.1:${port}`;
    server = spawn('node', [SCRIPT], {
      env: {
        ...process.env,
        DIST_DIR: dist,
        PORT: String(port),
        HOST: '127.0.0.1',
        REACTOME_BACKEND: `http://127.0.0.1:${backendPort}`,
        HEALTH_CONTENT_NODE: 'http://127.0.0.1:9/health',
        HEALTH_RENDER: 'http://127.0.0.1:9/health',
        HEALTH_MCP: 'http://127.0.0.1:9/health',
      },
      stdio: 'ignore',
    });
    expect(await waitForServer(base), 'the server came up').toBe(true);
  }, 40_000);

  afterAll(async () => {
    server?.kill('SIGTERM');
    backend?.close();
    if (dist) await rm(dist, { recursive: true, force: true });
  });

  for (const root of [
    '/ContentService',
    '/ContentService/',
    '/AnalysisService',
    '/AnalysisService/',
  ]) {
    it(`answers ${root} with this site's API page`, async () => {
      const before = reached.length;
      const body = await (await fetch(base + root)).text();
      expect(body).toContain(INDEX_MARKER);
      expect(reached.length, 'the service was not asked').toBe(before);
    });
  }

  it('keeps the query string on the page, not the service', async () => {
    const body = await (await fetch(base + '/ContentService/?urls.primaryName=x')).text();
    expect(body).toContain(INDEX_MARKER);
  });

  for (const api of [
    '/ContentService/data/database/version',
    '/ContentService/v3/api-docs',
    '/AnalysisService/v3/api-docs',
    '/ContentService/swagger-ui/index.html',
  ]) {
    it(`still sends ${api} to the service`, async () => {
      const body = await (await fetch(base + api)).text();
      expect(body).toBe(`backend ${api}`);
    });
  }

  it('leaves ExperimentDigester alone, which has no page here', async () => {
    const body = await (await fetch(base + '/ExperimentDigester/')).text();
    expect(body).toBe('backend /ExperimentDigester/');
  });
});
