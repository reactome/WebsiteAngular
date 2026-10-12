import { type Page } from '@playwright/test';
import { test, expect } from './support/backend';

/**
 * A request that fails is not an answer of "no".
 *
 * The IDG page read a failed name check as "not in the IDG data", which blames
 * the gene for the server, and a pathway whose details failed to load as one
 * with no description. Every IDG call is answered here, so no test reaches
 * idg.reactome.org.
 */

const LOAD = 60_000;
const IDG = 'https://idg.reactome.org/idgpairwise';
// Real, and in no other recording: the stubbed answers for it are pooled, and
// would otherwise be what another test borrowed for a pathway it shares.
const PATHWAY = { stId: 'R-HSA-69473', name: 'G2/M DNA damage checkpoint' };

function json(page: Page, url: string | RegExp, body: unknown, status = 200) {
  return page.route(url, (route) =>
    route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
  );
}

/**
 * The IDG service, answering with one enriched pathway or none. The name check
 * fails unless `known` is given, and never answers when it is 'held'.
 */
async function idg(
  page: Page,
  {
    pathways,
    known,
    failing,
  }: { pathways: boolean; known?: boolean | 'held'; failing?: 'levels' | 'features' }
) {
  await json(page, `${IDG}/datadesc`, [
    {
      id: 'BioGridBioPlexStringDB|Homo_sapiens|Protein_Interaction',
      digitalKey: 1,
      provenance: 'BioGridBioPlexStringDB',
      dataType: 'Protein_Interaction',
      bioSource: 'Homo_sapiens',
    },
  ]);
  await json(page, new RegExp(`${IDG}/relationships/combinedScoreGenesForTerm/`), {
    CHEK1: 0.95,
  });
  await json(
    page,
    `${IDG}/relationships/enrichedSecondaryPathwaysForTerm1`,
    pathways ? [{ ...PATHWAY, pVal: 0.001, fdr: 0.001, bottomLevel: true, numGenes: 1 }] : []
  );
  await json(
    page,
    `${IDG}/relationships/network/enrichedSecondaryPathaysForTerm`,
    failing === 'levels' ? { code: 500 } : [],
    failing === 'levels' ? 500 : 200
  );
  await json(page, `${IDG}/realtionships/getHierarchicalOrderedPathways`, []);
  await json(
    page,
    `${IDG}/pairwise/term/true`,
    failing === 'features' ? { code: 500 } : [],
    failing === 'features' ? 500 : 200
  );
  if (known === 'held')
    await page.route(new RegExp(`${IDG}/checkTerm/`), () => new Promise(() => {}));
  else
    await json(
      page,
      new RegExp(`${IDG}/checkTerm/`),
      known === undefined ? { code: 500 } : known,
      known === undefined ? 500 : 200
    );
  // The interactor analysis the pathway links carry: not what is tested here.
  await json(page, /\/AnalysisService\/identifiers\/projection/, { code: 500 }, 500);
}

const state = (page: Page) => page.locator('.state');

test.describe('The IDG page', () => {
  test('says a name the service does not know is not in its data', async ({ page }) => {
    await idg(page, { pathways: false, known: false });
    await page.goto('/idg?gene=XYZZY1');
    await expect(page.getByRole('heading', { name: 'XYZZY1 is not in the IDG data' })).toBeVisible({
      timeout: LOAD,
    });
  });

  test('does not call a name unknown when it could not check', async ({ page }) => {
    await idg(page, { pathways: false });
    const checked = page.waitForResponse(new RegExp(`${IDG}/checkTerm/`));
    await page.goto('/idg?gene=XYZZY1');
    await checked;
    await expect(page.getByRole('heading', { name: 'Nothing found for XYZZY1' })).toBeVisible({
      timeout: LOAD,
    });
    await expect(state(page)).toContainText(
      "The IDG service couldn't confirm whether it knows XYZZY1"
    );
    await expect(state(page)).not.toContainText('is not in the IDG data');
    await expect(state(page)).not.toContainText('XYZZY1 is known');
  });

  test('says nothing about the name while it is still being checked', async ({ page }) => {
    await idg(page, { pathways: false, known: 'held' });
    await page.goto('/idg?gene=XYZZY1');
    await expect(page.getByRole('heading', { name: 'Nothing found for XYZZY1' })).toBeVisible({
      timeout: LOAD,
    });
    await expect(state(page)).toContainText('No pathway is enriched at this threshold.');
    await expect(state(page)).not.toContainText('XYZZY1 is known');
    await expect(state(page)).not.toContainText('is not in the IDG data');
  });

  test('says when the target development levels could not be loaded', async ({ page }) => {
    await idg(page, { pathways: true, known: true, failing: 'levels' });
    await page.goto('/idg?gene=TANC1');
    await expect(page.getByRole('row', { name: new RegExp(PATHWAY.name) })).toBeVisible({
      timeout: LOAD,
    });
    await expect(
      page.getByText(
        "Couldn't load the target development levels, so the Weighted TDL column and the plot that uses them are empty. Please try again later."
      )
    ).toBeVisible();
  });

  test('says when the feature summary could not be loaded', async ({ page }) => {
    await idg(page, { pathways: true, known: true, failing: 'features' });
    await page.goto('/idg?gene=TANC1');
    await expect(page.getByRole('row', { name: new RegExp(PATHWAY.name) })).toBeVisible({
      timeout: LOAD,
    });
    await expect(
      page.getByText("Couldn't load the feature summary for TANC1. Please try again later.")
    ).toBeVisible();
  });

  test('says nothing of either when they load', async ({ page }) => {
    await idg(page, { pathways: true, known: true });
    const answered = Promise.all([
      page.waitForResponse(`${IDG}/relationships/network/enrichedSecondaryPathaysForTerm`),
      page.waitForResponse(`${IDG}/pairwise/term/true`),
    ]);
    await page.goto('/idg?gene=TANC1');
    await answered;
    await expect(page.getByRole('row', { name: new RegExp(PATHWAY.name) })).toBeVisible({
      timeout: LOAD,
    });
    await expect(page.getByText(/Couldn't load the (target|feature)/)).toHaveCount(0);
  });

  test.describe("a pathway's details", () => {
    const enhanced = new RegExp(`/data/query/enhanced/${PATHWAY.stId}(\\?|$)`);
    const ancestors = new RegExp(`/data/event/${PATHWAY.stId}/ancestors(\\?|$)`);
    const row = (page: Page) => page.locator('tr.detail');

    async function open(page: Page) {
      await idg(page, { pathways: true, known: true });
      await page.goto('/idg?gene=TANC1');
      await page.getByRole('button', { name: `Show details for ${PATHWAY.name}` }).click();
    }

    test('says when they could not be loaded', async ({ page }) => {
      await json(page, enhanced, { code: 500 }, 500);
      await json(page, ancestors, { code: 500 }, 500);
      await open(page);
      await expect(row(page)).toContainText(
        "Couldn't load this pathway's details. Please try again later.",
        { timeout: LOAD }
      );
      await expect(row(page)).not.toContainText('No description available');
    });

    test('says when some could not be loaded, and shows the rest', async ({ page }) => {
      await json(page, enhanced, { summation: [{ text: 'Checkpoints halt the cycle.' }] });
      await json(page, ancestors, { code: 500 }, 500);
      await open(page);
      await expect(row(page)).toContainText('Checkpoints halt the cycle.', { timeout: LOAD });
      await expect(row(page)).toContainText(
        "Couldn't load where this pathway sits in the hierarchy. Please try again later."
      );
    });

    test('says when a pathway has none', async ({ page }) => {
      await json(page, enhanced, {});
      await json(page, ancestors, []);
      await open(page);
      await expect(row(page)).toContainText('No description available.', { timeout: LOAD });
      await expect(row(page)).not.toContainText("couldn't be loaded");
    });
  });
});
