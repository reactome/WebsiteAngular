import { test, expect } from '@playwright/test';

/**
 * Notice when the exporter loses the files it draws from.
 *
 * `/ContentService/exporter/event/<id>.sbgn` is a button on the download panel
 * and on a detail page's download bar. For a **pathway** the Java service builds
 * it from that pathway's diagram JSON on local disk -- SBGN carries layout, and
 * a pathway's layout is a curated artefact that cannot be derived from the
 * graph. `ExportManager.getDiagram` returns **null** when the file is missing,
 * and that null goes straight into `new SbgnConverter(...)`, so the reader gets
 * a 500 that names nothing.
 *
 * Those files were deleted from this deployment and nobody noticed for weeks
 * (#230). 9,548 of the 9,559 pathways answered 500; the eleven that worked were
 * the ids our own fixtures use, so every spot check anyone ran came back
 * healthy.
 *
 * **Why this asks about a different pathway every run.** `getSBGN` tries
 * `getCachedFile` first, and only builds from the diagram JSON when that
 * misses:
 *
 *     try { file = exportManager.getCachedFile(event, fileName); ... }
 *     catch (MissingSBXXException | IOException e) {
 *         new SbgnConverter(exportManager.getDiagram(event)); ...
 *     }
 *
 * So a pathway that has been exported once is served from
 * `ContentService/exporter/<version>/sbgn/` for ever after, without reading the
 * diagram JSON at all. A fixed id in this file would be cached by its own first
 * run and would then keep passing after the files vanished -- a regression test
 * that guarantees its own blindness. Picking from a page of the schema endpoint,
 * rotated by the clock, means the assertion nearly always lands on a pathway
 * the cache has never seen.
 *
 * A **reaction** needs no file at all: `reactionExporter` computes its layout
 * from the graph. It is asserted separately so a failure says which half is
 * wrong -- pathway failing while reaction passes means the diagram JSON is
 * missing, rather than the exporter being broken.
 */
test.describe('SBGN export', () => {
  test.describe.configure({ timeout: 3 * 60 * 1000 });

  const PAGE_SIZE = 25;
  const REACTION = 'R-HSA-6805479';

  /** A pathway the exporter's cache has probably never been asked about. */
  async function aPathwayNobodyHasExported(request: import('@playwright/test').APIRequestContext) {
    // Rotated by the hour rather than randomised: a failure is reproducible for
    // long enough to look into, and successive runs still move on. 300 pages of
    // 25 covers well past the 9,559 pathways that have a diagram.
    const page = (Math.floor(Date.now() / 3_600_000) % 300) + 1;
    // No species filter. `schema/Pathway` accepts `speciesName` and ignores it --
    // asking for Homo sapiens returned R-MMU- and R-RNO- ids -- so naming it
    // would be a claim this file does not keep. Every species is the better pool
    // anyway: 8,152 of the 9,559 pathways with a diagram are inferred ones.
    const response = await request.get(
      `/ContentService/data/schema/Pathway?page=${page}&offset=${PAGE_SIZE}`
    );
    expect(response.ok(), `the schema endpoint answers for page ${page}`).toBe(true);

    const pathways = (await response.json()) as { stId: string; hasDiagram?: boolean }[];
    // One with a diagram of its own, so the assertion is about a file that has
    // to exist rather than about an ancestor's that might.
    const chosen = pathways.find((p) => p.hasDiagram) ?? pathways[0];
    expect(chosen?.stId, `page ${page} of the schema endpoint held a pathway`).toBeTruthy();
    return { stId: chosen.stId, page };
  }

  test('a pathway exports SBGN, which needs its diagram json on disk', async ({ request }) => {
    const { stId, page } = await aPathwayNobodyHasExported(request);
    const response = await request.get(`/ContentService/exporter/event/${stId}.sbgn`);
    const body = await response.text();

    expect(
      response.status(),
      `${stId} (schema page ${page}). A 500 here means the diagram json is missing ` +
        "from the exporter's directory, not that the exporter is broken -- the " +
        'reaction case below stays green in that situation. See #230, and ' +
        '~/restore-diagram-files.sh on the host.'
    ).toBe(200);
    expect(body, `${stId} returned SBGN rather than an error page`).toContain('<sbgn');
    // An empty map is a plausible-looking file: the wrapper serialises whether
    // or not anything was read into it.
    expect(body.length, `${stId} SBGN has something in it`).toBeGreaterThan(300);
  });

  test('a reaction exports SBGN, which needs no file at all', async ({ request }) => {
    const response = await request.get(`/ContentService/exporter/event/${REACTION}.sbgn`);
    expect(response.status(), 'the reaction exporter builds its own layout').toBe(200);
    const body = await response.text();
    expect(body).toContain('<sbgn');
    expect(body.length).toBeGreaterThan(300);
  });
});
