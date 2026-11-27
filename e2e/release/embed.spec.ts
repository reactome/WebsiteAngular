import { readFileSync } from 'node:fs';
import { type Page, test, expect } from '@playwright/test';

/**
 * The embeddable diagram, served by the site being released, on a partner's
 * page (spec 009, T050): the check to run against the stack that will serve
 * reactome.org before its cutover, and against any release candidate.
 *
 * The code suite (e2e/embed-diagram.spec.ts, e2e/embed-legacy-api.spec.ts)
 * tests the embed built from the working tree, served by a static server. This
 * asks the deployment instead: whether its nginx serves both addresses, and
 * whether the embed it serves takes its data and its loading picture from the
 * host it was loaded from (T043), not from a host written into a build.
 *
 * The partner's page is on a made-up origin of its own, answered in the
 * browser, so nothing but the site under test is asked for anything. Two pages:
 *
 *   - the supported address, /embed/diagram/v1/reactome-diagram.js, with
 *     <reactome-diagram>;
 *   - AllianceGenome's gene page as written, which loads the old widget's
 *     address, /DiagramJs/diagram/diagram.nocache.js, and polls for
 *     `Reactome` (specs/009-embeddable-diagram/host-page/alliance-old-address.html,
 *     with only its host changed to the site's).
 *
 *   E2E_BASE_URL=https://<site> npx playwright test --project=release e2e/release/embed.spec.ts
 *
 * Run from a machine that resolves the site to a loopback address (the site's
 * own host, say), Chrome's Local Network Access check refuses the public
 * partner page's requests to it; launch Chrome with
 * `--disable-features=LocalNetworkAccessChecks` there.
 */

const SITE = new URL(process.env['E2E_BASE_URL'] ?? 'http://localhost:4200').origin;
const PARTNER = 'https://partner.example';
const LOAD = 90_000;
const PATHWAY = 'R-HSA-69620';
// Where every deployment's diagram files come from (`s3` in environments.ts).
const DOWNLOAD = 'https://download.reactome.org';
// The address alliance-old-address.html names for the site, so a test can serve it.
const PAGE_HOST = 'http://localhost:4340/';
const ALLIANCE = readFileSync(
  'specs/009-embeddable-diagram/host-page/alliance-old-address.html',
  'utf8'
);

const SUPPORTED = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <title>A partner's page</title>
    <script src="${SITE}/embed/diagram/v1/reactome-diagram.js"></script>
  </head>
  <body>
    <h1>Gene X: pathways</h1>
    <reactome-diagram id="diagram" pathway="${PATHWAY}" style="display: block; width: 900px; height: 520px"></reactome-diagram>
    <script>
      window.__loaded = [];
      document.addEventListener('diagramloaded', (e) => window.__loaded.push(e.detail.pathway));
    </script>
  </body>
</html>`;

/** Serves `html` as the partner's page and records what the page asks for. */
async function partnerPage(page: Page, html: string) {
  expect(new URL(PARTNER).origin, 'the partner is another origin').not.toBe(SITE);
  const requests: string[] = [];
  page.on('request', (r) => requests.push(r.url()));
  await page.route(`${PARTNER}/**`, (route) =>
    route.fulfill({ contentType: 'text/html', body: html })
  );
  await page.goto(`${PARTNER}/gene.html`);
  return requests;
}

/** The drawn diagram's node count, read through the element's shadow roots. */
const nodes = (page: Page, holder: string) =>
  page.evaluate<number>(`(() => {
    const cy = document.querySelector(${JSON.stringify(holder)})
      ?.shadowRoot?.querySelector('reactome-diagram-view')?.shadowRoot
      ?.querySelector('#cytoscape')?._cyreg?.cy;
    return cy ? cy.nodes().length : 0;
  })()`);

/**
 * The view's loading picture as its styles name it, and whether that address
 * answers an image: a probe with the view's `loading` class, as the code
 * suite's check does.
 */
const loadingPicture = (page: Page, holder: string) =>
  page.evaluate(async (holder) => {
    const view = document
      .querySelector(holder)
      ?.shadowRoot?.querySelector('reactome-diagram-view')?.shadowRoot;
    if (!view) throw new Error('no view');
    const probe = document.createElement('div');
    probe.className = 'loading';
    view.appendChild(probe);
    const css = getComputedStyle(probe).backgroundImage;
    probe.remove();
    const url = /^url\("(.*)"\)$/.exec(css)?.[1] ?? '';
    const loads = await new Promise<boolean>((resolve) => {
      const image = new Image();
      image.onload = () => resolve(image.naturalWidth > 0);
      image.onerror = () => resolve(false);
      image.src = url;
    });
    return { url, loads };
  }, holder);

/** What both addresses must do once drawn: data and picture from the site. */
async function fromTheSite(page: Page, requests: string[], holder: string) {
  expect(await nodes(page, holder), 'nodes drawn').toBeGreaterThan(20);

  // Every request for data, to the site under test: not the partner's page,
  // and not a host written into the build (spec 009, T043).
  const data = requests.filter((u) =>
    /\/(ContentService|AnalysisService|ExperimentDigester)\//.test(new URL(u).pathname)
  );
  expect(
    data.filter((u) => u.includes('/ContentService/')).length,
    'it asked for data'
  ).toBeGreaterThan(0);
  expect([...new Set(data.map((u) => new URL(u).origin))], 'its data came from the site').toEqual([
    SITE,
  ]);
  // And no other Reactome host: a build that named one (beta's, served by the
  // release server) would ask it. The diagram files come from the download
  // host by design, for every deployment; fonts and structures from theirs.
  expect(
    [...new Set(requests.map((u) => new URL(u).origin))]
      .filter((o) => /(^|\.)reactome\.org$/.test(new URL(o).hostname))
      .filter((o) => o !== SITE && o !== DOWNLOAD),
    'no other Reactome host was asked'
  ).toEqual([]);

  const picture = await loadingPicture(page, holder);
  expect(picture.url, 'its loading picture is beside its code, on the site').toBe(
    `${SITE}/embed/diagram/v1/loader.gif`
  );
  expect(picture.loads, 'and the site answers it with an image').toBe(true);
}

test.describe('the embeddable diagram, served by the site being released', () => {
  test.describe.configure({ timeout: 3 * 60_000 });

  test('draws from the supported address on another origin, with the site’s data', async ({
    page,
  }) => {
    const requests = await partnerPage(page, SUPPORTED);
    await expect
      .poll(() => page.evaluate(() => (window as unknown as { __loaded: string[] }).__loaded), {
        timeout: LOAD,
      })
      .toContain(PATHWAY);
    expect(
      requests.some((u) => u === `${SITE}/embed/diagram/v1/reactome-diagram.js`),
      'its code came from the supported address'
    ).toBe(true);
    await fromTheSite(page, requests, '#diagram');
  });

  test('draws on AllianceGenome’s page as written, from the old address', async ({ page }) => {
    expect(ALLIANCE, 'the page names the address to replace').toContain(
      `${PAGE_HOST}DiagramJs/diagram/diagram.nocache.js`
    );
    const requests = await partnerPage(page, ALLIANCE.replaceAll(PAGE_HOST, `${SITE}/`));
    await expect
      .poll(
        () =>
          page.evaluate(() => {
            const w = window as unknown as { __loaded: string[]; __gaveUp: boolean };
            return w.__gaveUp ? 'gave up polling for Reactome' : w.__loaded;
          }),
        { timeout: LOAD }
      )
      .toContain(PATHWAY);
    expect(
      requests.some((u) => u === `${SITE}/DiagramJs/diagram/diagram.nocache.js`),
      'it loaded the old address'
    ).toBe(true);
    await fromTheSite(page, requests, '#reactomePathwayHolder reactome-diagram');
  });
});
