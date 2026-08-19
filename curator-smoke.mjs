import { chromium } from '@playwright/test';

// Drives the `development,curator` build (ng serve --port 4300) against the
// deployed curation backend at newcurator.reactome.org.
//
// Chromium runs with web security disabled: environment.ts builds DOWNLOAD /
// figures URLs absolute against newcurator, which sends no
// Access-Control-Allow-Origin. In production the curator bundle is served from
// newcurator itself so those are same-origin; only serving it from localhost
// makes them cross-origin. Set STRICT=1 to see the browser-default behaviour.
const BASE = 'http://localhost:4300/curatorgraph';
const OUT = '/tmp/curator-shots';
const STRICT = !!process.env.STRICT;

const args = ['--no-sandbox'];
if (!STRICT) args.push('--disable-web-security');

const browser = await chromium.launch({ args });
const ctx = await browser.newContext({ viewport: { width: 1500, height: 950 } });
const page = await ctx.newPage();

const errors = [];
const failedReqs = [];
const backend = new Map();

page.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text().replace(/\s+/g, ' ').slice(0, 220));
});
page.on('pageerror', (e) =>
  errors.push('PAGEERROR: ' + String(e).replace(/\s+/g, ' ').slice(0, 220))
);
page.on('requestfailed', (r) =>
  failedReqs.push(`${r.failure()?.errorText} ${r.url().slice(0, 150)}`)
);
page.on('response', (r) => {
  const u = r.url();
  if (
    /newcurator|GraphContentService|ContentService|AnalysisService|ExperimentDigester|\/download\/|\/figures\//.test(
      u
    )
  )
    backend.set(u.replace(/^https?:\/\//, '').slice(0, 150), r.status());
});

const results = [];
const step = async (name, fn) => {
  process.stdout.write(`\n### ${name}\n`);
  try {
    await fn();
    results.push(['PASS', name]);
    process.stdout.write(`  => PASS\n`);
  } catch (e) {
    results.push(['FAIL', name]);
    process.stdout.write(`  => FAIL: ${String(e).split('\n')[0]}\n`);
  }
};

const shot = (n) => page.screenshot({ path: `${OUT}/${n}.png` }).catch(() => {});

await step('website homepage renders the curator layout', async () => {
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('app-curator-home-shortcuts', { timeout: 60000 });
  await page.waitForTimeout(2500);
  await shot('01-home');
  const links = await page.locator('app-curator-home-shortcuts .shortcut-link').allInnerTexts();
  console.log('  shortcuts:', links.map((s) => s.trim().split('\n').pop()).join(' | '));
  console.log(
    '  app-home-shortcuts (main variant, expect 0):',
    await page.locator('app-home-shortcuts').count()
  );
});

await step('data schema browser loads from the curation graph', async () => {
  await page.goto(BASE + '/dataSchema', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(9000);
  await shot('02-dataschema');
  const txt = (await page.locator('body').innerText()).replace(/\s+/g, ' ');
  console.log('  body text length:', txt.length);
  console.log('  mentions DatabaseObject:', /DatabaseObject/i.test(txt));
});

const pathway = async (id, label, tag) => {
  await step(`pathway browser: ${label} (${id})`, async () => {
    await page.goto(`${BASE}/PathwayBrowser/${id}`, { waitUntil: 'domcontentloaded' });
    // The viewport shell first, then whatever the diagram renders into.
    // 'attached', not the default 'visible': cr-viewport has no layout box of
    // its own, so a visibility wait never settles even once it has rendered.
    // EHLD pathways render into cr-ehld, ordinary ones into cr-diagram.
    // 'attached', not the default 'visible': these custom elements have no
    // layout box of their own, so a visibility wait never settles.
    await page.waitForSelector('cr-diagram, cr-ehld', { state: 'attached', timeout: 90000 });
    await page.waitForTimeout(18000);
    await shot(tag);
    const counts = {
      'cr-diagram': await page.locator('cr-diagram').count(),
      'cr-ehld': await page.locator('cr-ehld').count(),
      canvas: await page.locator('canvas').count(),
      'ehld svg': await page.locator('cr-ehld svg').count(),
      'hierarchy nodes': await page.locator('mat-tree-node, .mat-tree-node').count(),
      'details panel': await page.locator('cr-details-panel').count(),
      'details tabs': await page.locator('[role=tab]').count(),
    };
    console.log('  ' + JSON.stringify(counts));
    const title = (
      await page
        .locator('cr-details-panel h1, cr-details-panel h2, h1')
        .first()
        .innerText()
        .catch(() => '(none)')
    )
      .replace(/\s+/g, ' ')
      .slice(0, 80);
    console.log('  details heading:', title);
    if (!counts.canvas && !counts['ehld svg']) throw new Error('no diagram surface rendered');
    if (!counts['details panel']) throw new Error('no details panel');
  });
};

// Apoptosis has an EHLD (SVG illustration); the Intrinsic Pathway below it is a
// regular cytoscape-rendered diagram -- covers both render paths.
await pathway('R-HSA-109581', 'Apoptosis, EHLD path', '03-pathway-ehld');
await pathway(
  'R-HSA-109606',
  'Intrinsic Pathway for Apoptosis, diagram path',
  '04-pathway-diagram'
);

await step('curator-hidden UI absent (Analyse / Compare / Overlay / Feedback)', async () => {
  for (const l of ['Analyse', 'Analyze', 'Compare', 'Overlay', 'Feedback']) {
    const n = await page.getByRole('button', { name: new RegExp(l, 'i') }).count();
    console.log(`  /${l}/i buttons: ${n}`);
    if (n > 0) throw new Error(`${l} still visible`);
  }
});

console.log('\n### backend responses');
for (const [u, s] of [...backend.entries()].sort((a, b) => a[0].localeCompare(b[0])))
  console.log(`  ${s}  ${u}`);

const uniq = [...new Set(errors)];
console.log(`\n### console errors (${errors.length} total, ${uniq.length} unique)`);
uniq.slice(0, 20).forEach((e) => console.log('  - ' + e));

const uniqReq = [...new Set(failedReqs)];
console.log(`\n### failed requests (${uniqReq.length} unique)`);
uniqReq.slice(0, 20).forEach((e) => console.log('  - ' + e));

console.log('\n### summary');
results.forEach(([r, n]) => console.log(`  ${r}  ${n}`));

await browser.close();
