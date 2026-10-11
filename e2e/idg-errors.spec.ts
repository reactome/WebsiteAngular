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
const PATHWAY = { stId: 'R-HSA-69620', name: 'Cell Cycle Checkpoints' };

function json(page: Page, url: string | RegExp, body: unknown, status = 200) {
  return page.route(url, (route) =>
    route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
  );
}

/** The IDG service, answering with one enriched pathway or none. */
async function idg(page: Page, { pathways, known }: { pathways: boolean; known?: boolean }) {
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
  await json(page, `${IDG}/relationships/network/enrichedSecondaryPathaysForTerm`, []);
  await json(page, `${IDG}/realtionships/getHierarchicalOrderedPathways`, []);
  await json(page, `${IDG}/pairwise/term/true`, []);
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
        "Some of this pathway's details couldn't be loaded. Please try again later."
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
