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
 * a 500 rather than anything that names the cause.
 *
 * Those files were deleted from this deployment and nobody noticed for weeks
 * (#230). 9,548 of the 9,559 pathways answered 500; the 11 that worked were the
 * ids our own fixtures use, so every spot check anyone ran came back healthy.
 * That is the shape this file is built against: assert on a pathway that is
 * **not** a fixture, so a surviving handful cannot make a broken deployment
 * look well.
 *
 * A **reaction** needs no file -- `reactionExporter` computes its layout from
 * the graph -- so the two cases are asserted separately. If the pathway case
 * fails while the reaction case passes, the diagram JSON is missing rather than
 * the exporter being broken.
 */
test.describe('SBGN export', () => {
  test.describe.configure({ timeout: 3 * 60 * 1000 });

  // Deliberately not one of the eleven that survived, and not an illustrated
  // pathway: Cell Cycle is an ordinary curated diagram nobody has a reason to
  // keep on disk specially.
  const PATHWAY = 'R-HSA-1640170';
  const REACTION = 'R-HSA-6805479';

  test('a pathway exports SBGN, which needs its diagram json on disk', async ({ request }) => {
    const response = await request.get(`/ContentService/exporter/event/${PATHWAY}.sbgn`);
    expect(
      response.status(),
      "a 500 here means the diagram json is missing from the exporter's directory, " +
        'not that the exporter is broken -- see the reaction case below, and #230'
    ).toBe(200);

    const body = await response.text();
    expect(body, 'the body is SBGN rather than an error page').toContain('<sbgn');
    // An empty map is a plausible-looking file: the wrapper serialises whether
    // or not anything was read into it.
    expect(body.length, 'SBGN with something in it').toBeGreaterThan(300);
  });

  test('a reaction exports SBGN, which needs no file at all', async ({ request }) => {
    const response = await request.get(`/ContentService/exporter/event/${REACTION}.sbgn`);
    expect(response.status(), 'the reaction exporter builds its own layout').toBe(200);
    const body = await response.text();
    expect(body).toContain('<sbgn');
    expect(body.length).toBeGreaterThan(300);
  });
});
