import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { createServer as createHttpServer, get as httpGet, type Server } from 'node:http';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { RUNTIME_PROFILES } from '../config/environments';

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

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** The health route's answer: its services by name, refused unless it has them. */
async function health(
  base: string
): Promise<{ ok: unknown; bundle: unknown; services: Record<string, unknown> }> {
  const body: unknown = await (await fetch(base + '/health')).json();
  if (!isRecord(body) || !isRecord(body['services'])) {
    throw new Error('the health route answered without its services');
  }
  return { ok: body['ok'], bundle: body['bundle'], services: body['services'] };
}

describe('serve-prod', () => {
  let dist = '';
  let embed = '';
  let base = '';
  let server: ChildProcess | undefined;

  beforeAll(async () => {
    // Under a directory whose name starts with a dot, as a checkout under
    // ~/.something or .claude/worktrees is: Express 5's sendFile refuses a
    // dotfile anywhere in an absolute path, and every page was a 500.
    dist = await mkdtemp(path.join(tmpdir(), '.serve-prod-'));
    await writeFile(path.join(dist, 'index.html'), `<!doctype html>${INDEX_MARKER}`, 'utf8');
    await mkdir(path.join(dist, 'assets'), { recursive: true });
    await writeFile(path.join(dist, 'assets', 'thing.txt'), 'an asset', 'utf8');
    // Build output named by its content, and files that keep their names.
    await writeFile(path.join(dist, 'main-AB12CD34.js'), 'export {};', 'utf8');
    await writeFile(path.join(dist, 'chunk-EF56GH78.js'), 'export {};', 'utf8');
    await mkdir(path.join(dist, 'media'), { recursive: true });
    await writeFile(path.join(dist, 'media', 'Roboto-IJ90KL12.ttf'), 'font', 'utf8');
    await mkdir(path.join(dist, 'content', 'documentation'), { recursive: true });
    await writeFile(path.join(dist, 'content', 'documentation', 'page.json'), '{}', 'utf8');
    await mkdir(path.join(dist, 'uploads'), { recursive: true });
    // Looks content-named, but an upload's name is whatever the author chose.
    await writeFile(path.join(dist, 'uploads', 'figure-ABCDEFGH.png'), 'png', 'utf8');
    embed = await mkdtemp(path.join(tmpdir(), 'serve-prod-embed-'));
    await writeFile(path.join(embed, 'main.js'), 'export const diagram = 1;', 'utf8');
    await writeFile(path.join(embed, 'loader.gif'), 'GIF89a', 'utf8');
    await writeFile(path.join(embed, 'chunk-AB12CD34.js'), 'export {};', 'utf8');
    await writeFile(path.join(embed, 'reactome-diagram.js'), '/* the loader */', 'utf8');

    const port = await freePort();
    base = `http://127.0.0.1:${port}`;
    server = spawn('node', [SCRIPT], {
      env: {
        ...process.env,
        DIST_DIR: dist,
        EMBED_DIST_DIR: embed,
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
    if (embed) await rm(embed, { recursive: true, force: true });
  });

  /**
   * The health route reports the services behind this one, and this suite runs
   * with none of them up — which is the case worth pinning. Every deployment
   * fault on this box has been something running a version from before the
   * merge with nothing saying so, and a health check that fell over when a
   * sibling was down would be reporting the estate under the name of the site.
   */
  it('reports each service, and says which are down', async () => {
    const body = await health(base);
    expect(Object.keys(body.services)).toEqual(
      expect.arrayContaining(['content-node', 'render', 'mcp'])
    );
    // Nothing is running in this suite, so every one of them is down and each
    // says so on its own rather than collapsing into a single failure.
    for (const [name, state] of Object.entries(body.services)) {
      expect(isRecord(state) ? state['up'] : state, `${name} should report its own state`).toBe(
        false
      );
    }
  });

  it('stays ok when a service behind it is down', async () => {
    // `ok` is the site's answer, not the estate's. The site renders without the
    // render service; telling a monitor otherwise pages somebody for the wrong
    // thing, and what is actually wrong is named in `services`.
    const body = await health(base);
    expect(body.ok).toBe(true);
    expect(body.bundle === null || typeof body.bundle === 'string').toBe(true);
  });

  it('serves the build at the root', async () => {
    const response = await fetch(base + '/');
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toMatch(/text\/html/);
    expect(await response.text()).toContain(INDEX_MARKER);
  });

  it('sends the page exactly as built when no deployment is named', async () => {
    // Beta's systemd service sets no SITE_PROFILE; its pages must not change.
    expect(await (await fetch(base + '/')).text()).toBe(`<!doctype html>${INDEX_MARKER}`);
  });

  it('serves a real asset as itself', async () => {
    const response = await fetch(base + '/assets/thing.txt');
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toMatch(/text\/plain/);
    expect(await response.text()).toBe('an asset');
  });

  it('caches content-named build output for good', async () => {
    for (const file of ['/main-AB12CD34.js', '/chunk-EF56GH78.js', '/media/Roboto-IJ90KL12.ttf']) {
      const response = await fetch(base + file);
      expect(response.headers.get('cache-control'), file).toBe(
        'public, max-age=31536000, immutable'
      );
    }
  });

  it('has browsers check back for files that change under the same name', async () => {
    // Pages, uploads and assets keep their names when they change. Cached for
    // a year as immutable, a rewritten documentation page stayed old in every
    // browser that had seen it.
    const content = await fetch(base + '/content/documentation/page.json');
    expect(content.headers.get('cache-control')).toBe('no-cache');
    // Pictures and other files: minutes, not a year.
    for (const file of ['/uploads/figure-ABCDEFGH.png', '/assets/thing.txt']) {
      const response = await fetch(base + file);
      expect(response.status, file).toBe(200);
      expect(response.headers.get('cache-control'), file).toBe('public, max-age=300');
    }
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

  // The embeddable diagram (spec 009) is loaded by other sites' pages: as a
  // module script it needs the cross-origin header, and a missing file must
  // be a 404 -- not the site's index.html with a 200, which a partner's page
  // would try to run as the diagram.
  describe('the embeddable diagram', () => {
    it('is served to other origins', async () => {
      const res = await fetch(base + '/embed/diagram/v1/main.js');
      expect(res.status).toBe(200);
      expect(await res.text()).toContain('export const diagram');
      expect(res.headers.get('access-control-allow-origin')).toBe('*');
      expect(res.headers.get('cross-origin-resource-policy')).toBe('cross-origin');
      // The script is replaced in place on each release, so it revalidates.
      expect(res.headers.get('cache-control')).toBe('no-cache');
    });

    it('caches its media for longer than its script', async () => {
      const res = await fetch(base + '/embed/diagram/v1/loader.gif');
      expect(res.status).toBe(200);
      expect(res.headers.get('cache-control')).toContain('max-age=86400');
    });

    it('caches its content-named chunks for good, and only those', async () => {
      // A chunk's name is its content, so it never changes meaning; main.js
      // does, on every release, and must not be pinned to the old one.
      const chunk = await fetch(base + '/embed/diagram/v1/chunk-AB12CD34.js');
      expect(chunk.headers.get('cache-control')).toContain('immutable');
      const main = await fetch(base + '/embed/diagram/v1/main.js');
      expect(main.headers.get('cache-control')).toBe('no-cache');
    });

    it('answers 404 for a file it does not have, not the site', async () => {
      const res = await fetch(base + '/embed/diagram/v1/nothing-here.js');
      expect(res.status).toBe(404);
      expect(await res.text()).not.toContain(INDEX_MARKER);
    });

    // Pages written for the old widget still load it from its old address
    // (AllianceGenome's gene pages). The loader is served there, as a script
    // other origins may run; the site's page there, as before, broke them.
    it("serves its loader at the old widget's address", async () => {
      const res = await fetch(base + '/DiagramJs/diagram/diagram.nocache.js');
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toContain('javascript');
      expect(await res.text()).toBe('/* the loader */');
      expect(res.headers.get('access-control-allow-origin')).toBe('*');
      expect(res.headers.get('cross-origin-resource-policy')).toBe('cross-origin');
      expect(res.headers.get('cache-control')).toBe('no-cache');
    });

    it("answers 404 for the old widget's other files, not the site", async () => {
      for (const file of [
        '/DiagramJs/diagram/0A1B2C.cache.js',
        '/DiagramJs/',
        '/DiagramJs/diagram/main.js',
      ]) {
        const res = await fetch(base + file);
        expect(res.status).toBe(404);
        expect(await res.text()).not.toContain(INDEX_MARKER);
      }
    });
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
  let contentNode: Server | undefined;
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

    const contentNodePort = await freePort();
    const node = createHttpServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end(`content-node ${req.url}`);
    });
    contentNode = node;
    await new Promise<void>((resolve) => node.listen(contentNodePort, '127.0.0.1', resolve));

    const port = await freePort();
    base = `http://127.0.0.1:${port}`;
    server = spawn('node', [SCRIPT], {
      env: {
        ...process.env,
        DIST_DIR: dist,
        PORT: String(port),
        HOST: '127.0.0.1',
        REACTOME_BACKEND: `http://127.0.0.1:${backendPort}`,
        CONTENT_NODE_TARGET: `http://127.0.0.1:${contentNodePort}`,
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
    contentNode?.close();
    if (dist) await rm(dist, { recursive: true, force: true });
  });

  // The same routes the dev server's are checked against (proxy-order.spec.ts):
  // the person, their publications, the four lists and every other attribute
  // go to node; nothing below an attribute does.
  for (const [url, to] of [
    ['/ContentService/data/person/68285/authoredPathways', 'content-node'],
    ['/ContentService/data/person/68285/reviewedReactions?page=1', 'content-node'],
    ['/ContentService/data/person/68285', 'content-node'],
    ['/ContentService/data/person/68285/publications', 'content-node'],
    ['/ContentService/data/person/68285/displayName', 'content-node'],
    ['/ContentService/data/person/68285/authoredPathwaysAndMore', 'content-node'],
    ['/ContentService/data/person/68285/displayName/x', 'backend'],
    ['/ContentService/data/query/70486/displayName', 'content-node'],
    ['/ContentService/data/query/70486/more', 'content-node'],
    ['/ContentService/data/query/abridged/70486', 'content-node'],
    ['/ContentService/data/query/abridged/70486/displayName', 'content-node'],
    ['/ContentService/data/query/abridged/70486/displayName/x', 'backend'],
    ['/ContentService/data/query/70486/moreover', 'content-node'],
    ['/ContentService/data/query/R-HSA-70486', 'content-node'],
    ['/ContentService/data/query/R-HSA-70486?view=nested', 'content-node'],
    ['/ContentService/data/query/enhanced/R-HSA-70486', 'content-node'],
    ['/ContentService/data/query/enhanced/v2/R-HSA-70486', 'content-node'],
    // The batch lookup is node's too (spec 006 T071).
    ['/ContentService/data/query/ids', 'content-node'],
    ['/ContentService/data/query/ids/map', 'content-node'],
  ]) {
    it(`sends ${url} to ${to}`, async () => {
      expect(await (await fetch(base + url)).text()).toBe(`${to} ${url}`);
    });
  }

  for (const root of [
    '/ContentService',
    '/ContentService/',
    '/AnalysisService',
    '/AnalysisService/',
  ]) {
    it(`answers ${root} with this site's API page`, async () => {
      const before = reached.length;
      const response = await fetch(base + root);
      const body = await response.text();
      expect(body).toContain(INDEX_MARKER);
      expect(reached.length, 'the service was not asked').toBe(before);
      // Never kept at the edge: the API's addresses are cached there, and a
      // stored page would outlive the next deploy's scripts (spec 011).
      expect(response.headers.get('cache-control')).toBe('no-store');
    });
  }

  it('keeps the query string on the page, not the service', async () => {
    const body = await (await fetch(base + '/ContentService/?urls.primaryName=x')).text();
    expect(body).toContain(INDEX_MARKER);
  });

  for (const api of [
    // A path still answered by Java (spec 010: the PSICQUIC interactors stay
    // there). /database/version, then /query/{id}/displayName, then
    // /query/abridged/{id}, then /pathways/top/{species}/curated, then
    // /detail/{id}/getSubGraph, were the example until each moved to the node
    // content service.
    '/ContentService/interactors/psicquic/molecule/MINT/P04637/details',
    '/ContentService/v3/api-docs',
    '/AnalysisService/v3/api-docs',
    '/ContentService/swagger-ui/index.html',
  ]) {
    it(`still sends ${api} to the service`, async () => {
      const body = await (await fetch(base + api)).text();
      expect(body).toBe(`backend ${api}`);
    });
  }

  it('sends /ContentService/data/database/version to the node content service', async () => {
    const body = await (await fetch(base + '/ContentService/data/database/version')).text();
    expect(body).toBe('content-node /ContentService/data/database/version');
  });

  it("sends beta's BioPAX download by dbId to the legacy service, as nginx does", async () => {
    // Level 3 by dbId only (dev.conf): any other form is the app, there too.
    const api = '/ReactomeRESTfulAPI/RESTfulWS/biopaxExporter/Level3/109862';
    expect(await (await fetch(base + api)).text()).toBe(`backend ${api}`);
    for (const other of [`${api}/`, '/ReactomeRESTfulAPI/RESTfulWS/biopaxExporter/Level3/R-HSA-1'])
      expect([other, await (await fetch(base + other)).text()]).toEqual([
        other,
        expect.stringContaining(INDEX_MARKER),
      ]);
  });

  it('leaves ExperimentDigester alone, which has no page here', async () => {
    const body = await (await fetch(base + '/ExperimentDigester/')).text();
    expect(body).toBe('backend /ExperimentDigester/');
  });
});

// Pages that gave up on a request (a render abandoned after its time) left
// their requests to the content service running, and the answers unread: the
// site server held thousands of sockets to it, in CLOSE-WAIT and ESTABLISHED,
// and the content service slowed to seconds per answer until the site server
// was restarted. A backend request must end with the request it answers.
describe('serve-prod and requests given up', () => {
  const CLIENTS = 20;
  // Larger than a socket's buffers, so an answer nobody reads cannot drain.
  const ANSWER = Buffer.alloc(8 * 1024 * 1024, 'x');
  let dist = '';
  let port = 0;
  let server: ChildProcess | undefined;
  let contentNode: Server | undefined;
  let open = 0;
  let requests = 0;
  let delayMs = 0;

  beforeAll(async () => {
    dist = await mkdtemp(path.join(tmpdir(), 'serve-prod-abort-'));
    await writeFile(path.join(dist, 'index.html'), `<!doctype html>${INDEX_MARKER}`, 'utf8');

    // A slow content service, counting the connections it has open.
    const node = createHttpServer((_req, res) => {
      requests++;
      setTimeout(() => {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(ANSWER);
      }, delayMs);
    });
    node.on('connection', (socket) => {
      open++;
      socket.on('close', () => open--);
    });
    contentNode = node;
    const contentNodePort = await freePort();
    await new Promise<void>((resolve) => node.listen(contentNodePort, '127.0.0.1', resolve));

    port = await freePort();
    server = spawn('node', [SCRIPT], {
      env: {
        ...process.env,
        DIST_DIR: dist,
        PORT: String(port),
        HOST: '127.0.0.1',
        REACTOME_BACKEND: 'http://127.0.0.1:9',
        CONTENT_NODE_TARGET: `http://127.0.0.1:${contentNodePort}`,
        HEALTH_CONTENT_NODE: 'http://127.0.0.1:9/health',
        HEALTH_RENDER: 'http://127.0.0.1:9/health',
        HEALTH_MCP: 'http://127.0.0.1:9/health',
      },
      stdio: 'ignore',
    });
    expect(await waitForServer(`http://127.0.0.1:${port}`), 'the server came up').toBe(true);
  }, 40_000);

  afterAll(async () => {
    server?.kill('SIGTERM');
    contentNode?.closeAllConnections();
    contentNode?.close();
    if (dist) await rm(dist, { recursive: true, force: true });
  });

  /** A request to a content-node route, for the caller to give up on. */
  function abandoned(id: number) {
    const request = httpGet({
      host: '127.0.0.1',
      port,
      path: `/ContentService/data/query/enhanced/R-HSA-${id}`,
      agent: false,
    });
    request.on('error', () => undefined);
    request.on('response', (response) => response.resume());
    return request;
  }

  /** Waits until `done()` holds or `timeoutMs` passes. */
  async function until(done: () => boolean, timeoutMs: number) {
    const deadline = Date.now() + timeoutMs;
    while (!done() && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  }

  for (const [when, delay, abortAfter] of [
    // The page gave up before the content service answered.
    ['before the answer', 1_000, 200],
    // The page gave up partway through reading the answer.
    ['while reading the answer', 0, 300],
  ] as const) {
    it(`closes the content service's connection when the page gives up ${when}`, async () => {
      delayMs = delay;
      const before = requests;
      const pages = Array.from({ length: CLIENTS }, (_, id) => abandoned(id));
      // Give up only once every request has reached the content service: one
      // given up sooner never reaches it, and proves nothing. On a busy host
      // that can take longer than the delays below.
      await until(() => requests - before === CLIENTS, 5_000);
      expect(requests - before, 'the requests reached the content service').toBe(CLIENTS);
      await new Promise((resolve) => setTimeout(resolve, abortAfter));
      for (const page of pages) page.destroy();
      // Well after the answers were written: an abandoned request's connection
      // is closed, not held with its answer unread.
      await until(() => open === 0, delay + 3_000);
      expect(open, 'connections still open').toBe(0);
    }, 15_000);
  }

  it('still delivers a whole answer to a page that waits for it', async () => {
    delayMs = 0;
    const body = await (
      await fetch(`http://127.0.0.1:${port}/ContentService/data/query/enhanced/R-HSA-1`)
    ).arrayBuffer();
    expect(body.byteLength).toBe(ANSWER.length);
  });
});

// specs/032 T006: one image for beta and the release server, the deployment
// named when the site is served.
describe('serve-prod as a deployment named when it is served', () => {
  let dist = '';
  let base = '';
  let server: ChildProcess | undefined;
  const LINE = '<script>window.__APP_ENV="release";</script>';

  beforeAll(async () => {
    dist = await mkdtemp(path.join(tmpdir(), 'serve-prod-profile-'));
    await writeFile(
      path.join(dist, 'index.html'),
      `<!doctype html><html><head><meta charset="utf-8">${INDEX_MARKER}</head><body><script src="main-AB12CD34.js" type="module"></script></body></html>`,
      'utf8'
    );
    const port = await freePort();
    base = `http://127.0.0.1:${port}`;
    server = spawn('node', [SCRIPT], {
      env: {
        ...process.env,
        DIST_DIR: dist,
        PORT: String(port),
        HOST: '127.0.0.1',
        SITE_PROFILE: 'release',
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

  for (const page of ['/', '/about/news', '/index.html']) {
    it(`names the deployment in ${page}, before the app's scripts run`, async () => {
      const response = await fetch(base + page);
      expect(response.status).toBe(200);
      expect(response.headers.get('content-type')).toMatch(/text\/html/);
      expect(response.headers.get('cache-control')).toBe('no-cache');
      const html = await response.text();
      expect(html.startsWith(`<!doctype html><html><head>${LINE}<meta charset`), html).toBe(true);
      expect(html.split(LINE)).toHaveLength(2);
      expect(html.indexOf(LINE)).toBeLessThan(html.indexOf('main-AB12CD34.js'));
    });
  }

  it('refuses to start with a name it cannot serve', async () => {
    // Beta is a real deployment, but a build's, not one chosen when serving: a
    // name reached both ways is two deployments sharing hosts by accident.
    for (const name of ['beta', 'relase']) {
      const child = spawn('node', [SCRIPT], {
        env: { ...process.env, DIST_DIR: dist, PORT: String(await freePort()), SITE_PROFILE: name },
        stdio: ['ignore', 'ignore', 'pipe'],
      });
      let stderr = '';
      child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString()));
      const code = await new Promise<number | null>((resolve) => {
        const timer = setTimeout(() => {
          child.kill('SIGTERM');
          resolve(null);
        }, 10_000);
        child.on('exit', (exitCode) => {
          clearTimeout(timer);
          resolve(exitCode);
        });
      });
      expect(code, `${name}: exits rather than serving`).toBe(1);
      expect(stderr).toContain(`"${name}"`);
      expect(stderr).toContain('release');
    }
  }, 30_000);

  it('accepts exactly the deployments the site chooses when served', async () => {
    // serve-prod.js is plain JavaScript and starts a server when loaded, so its
    // list is read as text; environments.ts's is the one the site obeys.
    const text = await readFile(SCRIPT, 'utf8');
    const list = /const RUNTIME_PROFILES = (\[[^\]]*\]);/.exec(text)?.[1] ?? 'missing';
    expect(JSON.parse(list.replace(/'/g, '"'))).toEqual([...RUNTIME_PROFILES]);
  });
});
