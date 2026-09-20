import { test, expect } from '@playwright/test';

/**
 * Notice when the node content service stops serving.
 *
 * `/ContentService/data/content/toc` and `/doi` are answered by the node port
 * (tools/content-node), with Tomcat as a `backup` upstream so a node fault
 * degrades to Java's answer rather than a 502. That safety net is the reason
 * this file exists: after it, **a node outage is invisible in the response**.
 * The page still renders, the reader still gets a contents list, and nothing
 * says that the thing we deployed stopped doing the work.
 *
 * The difference between the two answers is the one Java drops: a subpathway's
 * DOI. `ContentPageManager` passes null where it belongs, so Java returns none
 * and node returns 107 of 215 on release 97. That makes the DOIs a usable
 * signal for which backend answered, without asking either of them.
 *
 * In the release suite rather than the code suite on purpose: it asks "is the
 * deployment serving what we think it is", which is a question about a running
 * site and not about this repository's code. It runs against whatever
 * E2E_BASE_URL names.
 */
test.describe('Content endpoints are served by the node port', () => {
  test.describe.configure({ timeout: 2 * 60 * 1000 });

  test('subpathways carry their DOIs, which only node sends', async ({ request }) => {
    const response = await request.get('/ContentService/data/content/toc');
    expect(response.ok(), 'the contents endpoint answers at all').toBe(true);

    const pathways = (await response.json()) as {
      displayName: string;
      subpathways?: { stId: string; doi?: string }[];
    }[];
    expect(pathways.length, 'top-level pathways').toBeGreaterThan(20);

    const children = pathways.flatMap((pathway) => pathway.subpathways ?? []);
    const withDoi = children.filter((child) => child.doi);

    // Nought is the specific, meaningful failure: Java answered. Either the
    // node container is down or broken and the backup upstream carried the
    // request -- which is the arrangement working as designed, and still
    // something somebody should know about.
    expect(
      withDoi.length,
      `${children.length} subpathways and none carry a DOI, so Java answered this. ` +
        'The node content service is down, broken, or no longer routed; the backup ' +
        'upstream is hiding it. Check `docker compose ps content-node` and ' +
        'http://127.0.0.1:4400/health, which reports `graph: true|false`.'
    ).toBeGreaterThan(0);
  });

  test('an endpoint node does not implement is still answered by Java', async ({ request }) => {
    // The routes are two exact matches rather than a /data/content/ prefix,
    // precisely so this keeps working. A prefix would hand node a path it does
    // not implement and turn a working page into a 404.
    const response = await request.get('/ContentService/data/content/contributors');
    expect(response.ok(), 'contributors is still served, by Java').toBe(true);
    const contributors = (await response.json()) as unknown[];
    expect(contributors.length).toBeGreaterThan(0);
  });
});
