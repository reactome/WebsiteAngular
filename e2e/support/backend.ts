/**
 * Backend responses come from recordings, not from a live server.
 *
 * CI used to point `REACTOME_BACKEND` at https://reactome.org, so every push ran
 * the whole suite against the **public site** -- roughly 1,400 requests a run.
 * Besides the load, it made the suite fail whenever production had a bad minute:
 * a Cloudflare 521 arrived as
 *
 *     TimeoutError: page.waitForSelector: Timeout 90000ms exceeded.
 *       - waiting for locator('#cytoscape canvas') to be visible
 *
 * which says nothing about a backend and teaches you to press re-run (#217).
 *
 * Recording uses Playwright's own HAR writer. Replay does not use its reader:
 * `routeFromHAR` matches on the whole URL including the origin, so a recording
 * taken at `127.0.0.1:4253` misses every request at `localhost:4200` and the run
 * goes red for a reason that has nothing to do with the code. Measured, not
 * assumed -- recording and replaying on the same server through two spellings of
 * the same host was enough to fail it.
 *
 * So entries are matched on **method, path and query**, and the origin is
 * ignored. Record wherever it is convenient; replay wherever CI happens to serve.
 *
 * Two recordings per test. Playwright's HAR writer only sees **browser** traffic,
 * but several specs probe the backend through the `request` fixture -- an API
 * context the browser knows nothing about -- to decide whether to skip:
 *
 *     const up = await serves(request, '/ContentService/data/query/…');
 *     test.skip(!up, 'the content service is not reachable from here');
 *
 * Those calls are invisible to `routeFromHAR`, so under replay they reach the
 * closed port, fail, and the test **skips itself**. Fourteen of them did, and a
 * suite that quietly runs fourteen fewer tests while reporting green is worse
 * than one that fails. So they are recorded alongside, into `<name>.api.json`,
 * and replayed from there.
 *
 * One recording per **test**, not per spec file. Playwright writes the HAR when a
 * browser context closes, and every test gets its own context -- so tests sharing
 * a file overwrite each other rather than merging, and the last one wins. A spec
 * whose final test skips would close having requested nothing and leave an empty
 * file: `custom-interactor-dialog` recorded 0 entries for 9 tests that way, and
 * `content-pages` 5 for 18. Every recording lives in one directory even so,
 * because Playwright names response bodies by their content hash -- identical
 * payloads across tests collapse to a single file only while they are siblings.
 */
import {
  test as base,
  expect,
  type APIRequestContext,
  type BrowserContext,
  type TestInfo,
} from '@playwright/test';
import path from 'node:path';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { BACKEND, hasBody, isTruncated } from './har-entry.mjs';

const RECORD = process.env['E2E_RECORD'] === '1';

/**
 * Everything this site treats as "the backend". Anything else is untouched.
 *
 * `idg.reactome.org` is in here because the browser calls it **directly** --
 * `IDG_SERVICE` is an absolute URL and it is not in `proxy.conf.js` -- so it is
 * not covered by pointing REACTOME_BACKEND anywhere. Without this line every run
 * of the suite, on every push, reached that server.
 *
 * Something must follow the service's slash. The bare roots, `/ContentService/`
 * and `/AnalysisService/`, are this site's API page rather than the service
 * (proxy.conf.js `apiPage`), and recording one would replay a copy of the page
 * instead of testing what the server does with the address.
 */
// The pattern itself lives in har-entry.mjs, which the recordings check shares.

/**
 * Hosts outside this site that the suite is allowed to reach, and why.
 *
 * The fixture above stops the suite calling ContentService, AnalysisService,
 * ExperimentDigester and IDG. Nothing stopped it calling the *next* service
 * somebody wired in. IDG is the worked example: `IDG_SERVICE` is an absolute URL
 * and is not in `proxy.conf.js`, so pointing REACTOME_BACKEND at a closed port
 * never affected it, and every CI run reached that server until a person -- not
 * a check -- noticed.
 *
 * Measured across the suite rather than guessed, which is the only reason this
 * list is right. From an audit run that logged every foreign host per test: at
 * least 89 tests reach Google Fonts, 89 reach jsDelivr for the pdbe-molstar
 * viewer that `pathway-browser/src/index.html` loads, 49 reach
 * download.reactome.org and 40 reach EBI. Floors rather than totals -- that run
 * lost its dev server partway and some tests never got to ask for anything.
 *
 * The issue that asked for this named one known exception. Declared here and in
 * BLOCKED below: fourteen.
 */
const ALLOWED = new Map<string, string>([
  // A leading `*` means "any prefix, then exactly this". Needed because
  // `docs.google.com` redirects a published sheet to a shard-numbered host --
  // `doc-0c-5k-sheets.googleusercontent.com` one run, `doc-0c-4c-...` another --
  // so the host that serves the data cannot be written down in advance.
  //
  // Deliberately not `.googleusercontent.com`. That is Google's whole
  // user-content CDN, and it would have quietly allowed `lh3.googleusercontent.com`
  // and everything else under it -- a wildcard hole in a check whose only job is
  // to notice new third parties.
  ['*-sheets.googleusercontent.com', 'where docs.google.com redirects a published sheet to'],
  ['fonts.googleapis.com', 'index.html asks for Material Icons, Material Symbols and Roboto'],
  ['fonts.gstatic.com', 'the font files those stylesheets point at'],
  ['cdn.jsdelivr.net', 'pdbe-molstar, loaded by pathway-browser/src/index.html'],
  ['download.reactome.org', "Reactome's own download host, linked from the download pages"],
  ['www.ebi.ac.uk', 'Expression Atlas suggestions and the EBI pages the site links to'],
  ['alphafold.ebi.ac.uk', 'structure images on the entity pages'],
  ['rest.uniprot.org', 'protein records the detail pages resolve'],
  [
    'docs.google.com',
    'a data source, not an embed: release-calendar, editorial-calendar, collaboration and resources all read published Sheets from it',
  ],
  ['ssl.gstatic.com', "images for Google's published-sheet viewer"],
  [
    'dev.reactome.org',
    "the deployment's own asset host: `assetsHost` points icons and diagram JSON at it rather than the release bucket, so /icon/R-ICO-*.svg is fetched directly",
  ],
]);

/**
 * Hosts the suite must **not** reach, blocked on purpose and without failing.
 *
 * Analytics is the one that matters. `config/environments.ts` gives a `gtagId`
 * to reactome.org alone, and says why: "Sending beta, dev or curation traffic to
 * the public property would inflate the public site's numbers with hits it never
 * received". Nothing enforced that at test time, and `deltasignal-toggle.spec.ts`
 * -- which loads a production profile to prove the toggle is absent there --
 * loaded gtag and reported a page view on every run, in CI and locally.
 *
 * These are not failures: no test asserts on them, and the right answer is to
 * drop the request rather than to make somebody re-record it.
 */
const BLOCKED = new Map<string, string>([
  ['www.googletagmanager.com', 'test runs must not appear in the public property'],
  ['www.google-analytics.com', 'test runs must not appear in the public property'],
  [
    'js.hcaptcha.com',
    'the widget is never solved by a test; loading it only tells hCaptcha we ran',
  ],
  ['newassets.hcaptcha.com', 'assets for that widget'],
  ['www.youtube.com', 'see below: the player is a doorway to ten more hosts'],
  ['www.youtube-nocookie.com', 'the pathway browser tour video; the same player, privacy-enhanced'],
  ['static.hsappstatic.net', 'the HubSpot meetings widget, same reason'],
  ['csp.withgoogle.com', 'CSP violation reporting for the sheet viewer; telemetry, like analytics'],
  ['play.google.com', 'its /log endpoint, reached by the same viewer'],
]);

/**
 * Why the embeds above are blocked while docs.google.com is allowed.
 *
 * The line is what the site *needs* rather than what it merely displays.
 * `docs.google.com` serves published Sheets that four pages read as data --
 * `release-calendar.component.ts:65` fetches one as CSV -- so blocking it left
 * `/about/release-calendar` with no cards at all and failed
 * `content-pages.spec.ts:291` here and in CI. That was a wrong call made from a
 * symptom: the host was first seen serving a Slides viewer, and I did not check
 * what else asked for it. The viewer's telemetry is blocked instead, which is
 * the part nobody needs.
 *
 * The video and booking widgets are the other case: nothing reads them, and
 *
 * allowing them pulled in ten further hosts nobody had asked for:
 *
 *   googleads.g.doubleclick.net, static.doubleclick.net   Google's ad infrastructure
 *   play.google.com/log, csp.withgoogle.com               logging
 *   i.ytimg.com, yt3.ggpht.com, www.gstatic.com,
 *   ssl.gstatic.com, www.google.com                       player assets
 *   meetings.hubspot.com                                  with `parentHubspotUtk`
 *                                                         and the page URL
 *
 * Allowing a host means allowing whatever it decides to load next, and a test
 * run has no business handing a tracking token to anybody. The pages themselves
 * are unaffected: `/documentation/userguide/reactome-fiviz` has no iframe at all,
 * and the embeds live on pages whose tests assert text, not video.
 */

/**
 * Local services are not third parties: Tina runs on 4001, the render service on
 * its own port, and a recording taken at `127.0.0.1` replays at `localhost`.
 * Any port on these hostnames is this machine talking to itself.
 */
const LOCAL = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

/**
 * An exact host, or `*` followed by the literal a host must end with.
 *
 * One wildcard form, not two. A `.domain.com` form covering a domain and
 * everything under it was written first and then removed: nothing declared one,
 * and `e2e/` is outside vitest's `{src,projects,tools}` include, so a matching
 * mode nobody uses is also a mode nothing can test. The `*` form is exercised
 * for real -- `/about/release-calendar` renders only if the shard-numbered
 * sheet host is allowed.
 */
function declared(list: Map<string, string>, host: string): string | undefined {
  const exact = list.get(host);
  if (exact !== undefined) return exact;
  for (const [key, why] of list) {
    if (!key.startsWith('*')) continue;
    const suffix = key.slice(1);
    // `>` and not `>=`: something has to stand where the `*` is, so the bare
    // suffix on its own is not a match.
    if (host.endsWith(suffix) && host.length > suffix.length) return why;
  }
  return undefined;
}

/** Every request method that could reach the backend. */
const VERBS = ['get', 'post', 'head', 'put', 'patch', 'delete', 'fetch'] as const;
type Verb = (typeof VERBS)[number];

interface HarEntry {
  request: { method: string; url: string };
  response: {
    status: number;
    headers: { name: string; value: string }[];
    content: { text?: string; encoding?: string; mimeType?: string; _file?: string };
  };
}

/** `METHOD /path?query` -- deliberately without the origin. */
function key(method: string, url: string): string {
  const u = new URL(url);
  return `${method.toUpperCase()} ${u.pathname}${u.search}`;
}

/** Playwright writes large bodies beside the HAR and references them by name. */
function bodyOf(entry: HarEntry, harDir: string): Buffer {
  const c = entry.response.content;
  if (c._file) return readFileSync(path.join(harDir, c._file));
  if (c.text === undefined) return Buffer.alloc(0);
  return Buffer.from(c.text, c.encoding === 'base64' ? 'base64' : 'utf8');
}

function load(har: string): Map<string, HarEntry> {
  const log = JSON.parse(readFileSync(har, 'utf8')) as { log: { entries: HarEntry[] } };
  const index = new Map<string, HarEntry>();
  for (const entry of log.log.entries) {
    // A recorded status below 100 means the request never produced a response --
    // it was still in flight when the page navigated away, which is common for
    // the third-party PSICQUIC calls and for analysis polling. Leaving those out
    // means a request matching only such an entry is aborted, which is exactly
    // what happened to it when the recording was taken.
    if (entry.response.status < 100) continue;
    // Likewise a response cut off after its headers: recorded as a 200 with no
    // body. Served, it would be a successful empty answer the server never
    // gave, and the page quietly shows nothing -- one test skipped itself for
    // weeks on an empty ancestors list. So it is not replayed: the request falls
    // to the pooled recordings like any other miss (another test's complete
    // copy) and is aborted if none has one.
    if (isTruncated(entry)) continue;
    // First write wins. A spec that asks for the same thing twice recorded it
    // twice; the responses match, and the first is the one it saw first --
    // unless the first has no body and a later one does. A request cancelled
    // mid-stream (a resource re-firing, say) is recorded as a 200 with nothing
    // in it, and serving that made every replay see an empty response where
    // the recording itself had the real one.
    const k = key(entry.request.method, entry.request.url);
    const kept = index.get(k);
    if (!kept || (!hasBody(kept) && hasBody(entry))) index.set(k, entry);
  }
  return index;
}

/**
 * `<spec>--<test title>`, readable so a diff says which test changed, and slugged
 * so it is a filename. The short digest keeps two tests whose titles slug to the
 * same thing from sharing a recording.
 */
function recordingName(testInfo: { file: string; titlePath: string[] }): string {
  const spec = path.basename(testInfo.file).replace(/\.spec\.ts$/, '');
  const title = testInfo.titlePath.slice(1).join(' ');
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60);
  const digest = createHash('sha1').update(title).digest('hex').slice(0, 6);
  return `${spec}--${slug}-${digest}`;
}

/** A probe's recorded answer, keyed like the HAR entries. */
interface ApiRecording {
  status: number;
  headers: Record<string, string>;
  body: string;
  encoding: 'utf8' | 'base64';
}

/** Enough of APIResponse for what the specs ask of it. */
function fakeResponse(rec: ApiRecording) {
  const buffer = Buffer.from(rec.body, rec.encoding);
  return {
    ok: () => rec.status >= 200 && rec.status < 300,
    status: () => rec.status,
    statusText: () => '',
    url: () => '',
    headers: () => rec.headers,
    body: async () => buffer,
    text: async () => buffer.toString('utf8'),
    json: async () => JSON.parse(buffer.toString('utf8')),
    dispose: async () => {},
  };
}

/**
 * Every recording, pooled, as a fallback for one test's own.
 *
 * A request still in flight when its test ends is written with status -1 -- no
 * response was ever received -- and is therefore unusable. That is common for
 * reference data a page fetches once and does not wait for: the DOI page asks for
 * `/data/species/main`, the recording caught it mid-flight, and on replay the
 * abort left the page unable to initialise at all.
 *
 * These responses are the same wherever they are asked for, so a usable copy from
 * another test is a correct answer rather than a guess. A test's own recording
 * always wins; this is only consulted on a miss.
 */
let pooled: Map<string, HarEntry> | null = null;

function pool(harDir: string): Map<string, HarEntry> {
  if (pooled) return pooled;
  pooled = new Map<string, HarEntry>();
  for (const name of readdirSync(harDir)) {
    if (!name.endsWith('.har')) continue;
    for (const [k, entry] of load(path.join(harDir, name))) {
      if (!pooled.has(k)) pooled.set(k, entry);
    }
  }
  return pooled;
}

/**
 * Angular's own error codes, as a development build reports them: `NG0100`,
 * `NG05105`, and so on.
 *
 * The suite runs `ng serve`, a development build, and development builds check
 * things production builds silently skip. So these are exactly the faults a
 * reader on the production site never sees an error for, while the page stops
 * updating under them. The tissue form threw NG05105 for weeks (a dead
 * animation binding); the tests that touched it failed intermittently, or
 * passed while looking the other way, and nothing named the cause.
 */
const ANGULAR_ERROR = /\bNG0\d{3,4}\b/;

/**
 * Opt-out for a test that raises an Angular error on purpose. Say why:
 *
 *     test.info().annotations.push({ type: 'angular-errors', description: '...' });
 */
const ALLOW_ANGULAR_ERRORS = 'angular-errors';

/** How long a recording waits, at most, for a test's backend requests to finish. */
const RECORDING_SETTLE_MS = 15_000;

/**
 * Counts a context's backend requests in flight, and returns a wait for them
 * to finish. A request that never completes -- a long poll, a lookup the page
 * abandoned -- ends the wait at the ceiling rather than holding the test.
 */
function trackBackendRequests(context: BrowserContext) {
  const inFlight = new Set<object>();
  context.on('request', (request) => {
    if (BACKEND.test(request.url())) inFlight.add(request);
  });
  const done = (request: object) => inFlight.delete(request);
  context.on('requestfinished', done);
  context.on('requestfailed', done);
  return async (ceiling: number) => {
    const until = Date.now() + ceiling;
    while (inFlight.size > 0 && Date.now() < until) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  };
}

/**
 * Watches a test's pages for Angular errors, and fails the test on any once it
 * is done. Attached where the browser context is made, so only tests that use
 * a page pay for it -- an API-only test makes no context at all.
 */
function watchAngularErrors(context: BrowserContext) {
  const seen: string[] = [];
  const reads: Promise<void>[] = [];
  context.on('console', (message) => {
    if (message.type() !== 'error' || !ANGULAR_ERROR.test(message.text())) return;
    const first = message.text().split('\n')[0].slice(0, 300);
    // Angular logs the error object beside the text, and only the object has
    // the stack -- the part that says which component threw.
    reads.push(
      Promise.all(
        message
          .args()
          .map((arg) =>
            arg
              .evaluate((value) => (value instanceof Error ? (value.stack ?? '') : ''))
              .catch(() => '')
          )
      ).then((stacks) => {
        const where = stacks
          .join('\n')
          .split('\n')
          .filter((line) => /^\s+at /.test(line))
          .slice(0, 5)
          .map((line) => line.trim())
          .join(' / ');
        seen.push(where ? `${first} -- ${where}` : first);
      })
    );
  });
  context.on('weberror', (error) => {
    const text = String(error.error().stack ?? error.error());
    if (ANGULAR_ERROR.test(text)) seen.push(text.split('\n').slice(0, 6).join(' / ').slice(0, 900));
  });
  return {
    async check(testInfo: TestInfo) {
      await Promise.all(reads);
      const allowed = testInfo.annotations.some((a) => a.type === ALLOW_ANGULAR_ERRORS);
      // Only on a test that otherwise passed: a failing one already says what
      // went wrong, and this would bury it.
      if (!allowed && testInfo.status === testInfo.expectedStatus) {
        expect(seen, 'Angular reported errors (development build)').toEqual([]);
      }
    },
  };
}

export const test = base.extend({
  context: async ({ context, baseURL }, use, testInfo) => {
    const angular = watchAngularErrors(context);
    const har = path.join(testInfo.project.testDir, 'har', `${recordingName(testInfo)}.har`);

    if (RECORD) {
      await context.routeFromHAR(har, { url: BACKEND, update: true, notFound: 'fallback' });
      const settle = trackBackendRequests(context);
      // The wait below happens in this fixture's teardown, which counts against
      // the test's own time limit; give it room so a slow test does not time out
      // only when it is being recorded.
      testInfo.setTimeout(testInfo.timeout + RECORDING_SETTLE_MS);
      await use(context);
      // The HAR is written when the context closes, and a response still
      // streaming then is recorded as a 200 with no body -- replayed, a
      // successful empty answer the server never gave. So the context stays
      // open until the test's backend requests have finished, up to a ceiling.
      // Recording only: a replay has nothing to wait for.
      await settle(RECORDING_SETTLE_MS);
      await angular.check(testInfo);
      return;
    }

    const harDir = path.dirname(har);
    const entries = existsSync(har) ? load(har) : new Map<string, HarEntry>();

    const ownOrigin = new URL(baseURL ?? 'http://localhost:4200').origin;
    // host -> the first URL that asked for it, so the message can show one.
    const undeclared = new Map<string, string>();

    // Blocking needs interception; noticing does not. That distinction is the
    // whole design here, and it was learned the hard way.
    //
    // The first version matched with a **function**, which Playwright cannot
    // hand to the browser as a URL pattern -- so every request on the page was
    // paused and round-tripped to Node. On a 78,000px documentation page with
    // 116 images that is a lot of pausing, and under the suite's four workers it
    // delayed layout enough that `content-pages.spec.ts:128`, which polls where a
    // heading comes to rest after a smooth scroll, failed three runs out of
    // three -- at 160px once and 3,802px another, because it was timing and not
    // geometry. Two full runs of `main` never failed it, and nothing was broken
    // on the page: 0 aborted requests, 0 broken images, identical document
    // height. The fixture was simply making the browser slower.
    //
    // So: BACKEND keeps its narrow pattern, BLOCKED hosts get a pattern of their
    // own, and everything else is watched passively through the `request` event,
    // which pauses nothing.
    // Exact hosts stay exact -- `[^/]*` in front of one would match
    // `evilwww.youtube.com` too -- while a `*` entry becomes a required prefix.
    const blockedPattern = new RegExp(
      `^https?://(${[...BLOCKED.keys()]
        .map((h) =>
          h.startsWith('*') ? `[^/]+${h.slice(1).replace(/\./g, '\\.')}` : h.replace(/\./g, '\\.')
        )
        .join('|')})/`
    );
    await context.route(blockedPattern, (route) => route.abort());

    // Passive. A host that is neither ours, nor local, nor declared is recorded
    // and reported when the test ends. Its request does leave once -- the
    // alternative costs every other request on the page, which is a worse trade
    // for a host that is about to be declared anyway.
    context.on('request', (request) => {
      let url;
      try {
        url = new URL(request.url());
      } catch {
        return;
      }
      if (url.protocol !== 'http:' && url.protocol !== 'https:') return;
      if (url.origin === ownOrigin || LOCAL.has(url.hostname)) return;
      if (declared(ALLOWED, url.host) || declared(BLOCKED, url.host)) return;
      if (BACKEND.test(request.url())) return;
      if (!undeclared.has(url.host)) undeclared.set(url.host, request.url());
    });

    await context.route(BACKEND, async (route) => {
      const method = route.request().method();
      const asked = key(method, route.request().url());
      // The pool is consulted for idempotent reads only. A POST's answer depends
      // on its body, which the key does not carry and the trimmed recordings do
      // not keep: eleven tests POST to
      // `/ContentService/interactors/static/molecules/details` with a different
      // list of accessions each, so borrowing another test's reply would hand one
      // pathway's interactors to another -- rendering plausible, wrong numbers.
      // A miss on a write is an abort, and an abort is visible.
      const shareable = method === 'GET' || method === 'HEAD';
      const entry = entries.get(asked) ?? (shareable ? pool(harDir).get(asked) : undefined);
      if (!entry) {
        // Aborted, never passed through. Falling back to the network would
        // quietly restore the thing this removes, and the first sign would be an
        // outage rather than a failing test.
        await route.abort();
        return;
      }
      const headers: Record<string, string> = {};
      for (const h of entry.response.headers) {
        // Recorded framing does not describe the body we are about to send.
        if (!/^(content-encoding|content-length|transfer-encoding)$/i.test(h.name)) {
          headers[h.name] = h.value;
        }
      }
      await route.fulfill({
        status: entry.response.status,
        headers,
        body: bodyOf(entry, harDir),
      });
    });

    await use(context);
    await angular.check(testInfo);

    // Thrown from the fixture rather than inside the handler, because a route
    // handler cannot fail a test -- it can only abort a request, which surfaces
    // as whatever the page does when an asset is missing. That is how IDG stayed
    // invisible. Naming the host and what to do about it is the whole point.
    if (undeclared.size) {
      const lines = [...undeclared].map(([host, url]) => `  ${host}  (first asked for ${url})`);
      throw new Error(
        `This test reached ${undeclared.size} host${undeclared.size === 1 ? '' : 's'} with no recordings:\n\n` +
          `${lines.join('\n')}\n\n` +
          'The request was sent -- detection here is passive, because pausing every\n' +
          'request to prevent one costs more than it saves. Declaring the host stops it\n' +
          'happening again: add it to BACKEND in e2e/support/backend.ts and re-record, or\n' +
          'list it in ALLOWED (reachable, with a reason) or BLOCKED (never wanted).'
      );
    }
  },

  // The `request` fixture is a separate API context: `context.route()` above does
  // not touch it. Backend probes made through it are recorded beside the HAR and
  // replayed from there, so a fixtured backend reads as *present* rather than
  // absent. Anything that is not the backend -- Tina, the render service, EBI --
  // passes straight through, recording and replaying alike.
  request: async ({ request, baseURL }, use, testInfo) => {
    const sidecar = path.join(
      testInfo.project.testDir,
      'har',
      `${recordingName(testInfo)}.api.json`
    );
    const recorded: Record<string, ApiRecording> = RECORD
      ? {}
      : existsSync(sidecar)
        ? (JSON.parse(readFileSync(sidecar, 'utf8')) as Record<string, ApiRecording>)
        : {};

    const absolute = (url: string) => new URL(url, baseURL ?? 'http://localhost:4200').toString();

    // Every method that can reach the backend, not just the ones the specs happen
    // to use today. `fetch` was the gap: a spec calling request.fetch() would have
    // slipped past the recordings and out to whatever REACTOME_BACKEND names.
    type Options = Parameters<APIRequestContext['get']>[1];

    const wrap = (method: Verb) => async (url: string, options?: Options) => {
      const full = absolute(url);
      if (!BACKEND.test(full)) {
        // The same classification as the browser route, because a probe written
        // in a spec can reach a third party just as quietly as the app can. The
        // site's own origin is always fine: it is what `absolute()` resolves a
        // relative path against, and it is not localhost when the suite is
        // pointed at a deployed site.
        const { host, hostname, origin } = new URL(full);
        const site = new URL(baseURL ?? 'http://localhost:4200').origin;
        if (origin === site || LOCAL.has(hostname) || declared(ALLOWED, host)) {
          return request[method](url, options);
        }
        const blocked = declared(BLOCKED, host);
        throw new Error(
          blocked
            ? `This test probed ${host}, which is blocked on purpose: ${blocked}.\n` +
                `  ${full}\n` +
                'If the probe is right and the block is wrong, move the host to ALLOWED in\n' +
                'e2e/support/backend.ts and say why it is worth reaching.'
            : `This test probed ${host}, which has no recordings and is not declared.\n` +
                `  ${full}\n` +
                'Add it to BACKEND in e2e/support/backend.ts and re-record, or declare it in\n' +
                'ALLOWED or BLOCKED in the same file.'
        );
      }

      const k = key(method, full);
      if (!RECORD) {
        const rec = recorded[k];
        // No recording means the probe never ran when this was taken. Report it
        // as unreachable rather than inventing a success -- but say so, because
        // silence here is what produced the fourteen skips.
        if (!rec) {
          console.warn(`[backend fixture] no recording for ${k}; reporting it unreachable`);
          return fakeResponse({ status: 0, headers: {}, body: '', encoding: 'utf8' });
        }
        return fakeResponse(rec);
      }

      const response = await request[method](url, options);
      const buffer = await response.body().catch(() => Buffer.alloc(0));
      const text = buffer.toString('utf8');
      const printable = Buffer.from(text, 'utf8').equals(buffer);
      recorded[k] = {
        status: response.status(),
        headers: response.headers(),
        body: printable ? text : buffer.toString('base64'),
        encoding: printable ? 'utf8' : 'base64',
      };
      return response;
    };

    const proxied = new Proxy(request, {
      get(target, prop, receiver) {
        if (VERBS.includes(prop as Verb)) return wrap(prop as Verb);
        return Reflect.get(target, prop, receiver) as unknown;
      },
    });

    await use(proxied);

    if (RECORD && Object.keys(recorded).length) {
      writeFileSync(sidecar, JSON.stringify(recorded, null, 0));
    }
  },
});

export { expect };
