/**
 * The content service's API description, /ContentService/openapi.json (spec
 * 016, T028), served from projects/contract/openapi.json rather than from a
 * recording. The service publishes that file as it is, so the API page is
 * tested against the description this commit generates, and a recording does
 * not hold a second copy of it (900 KB) that goes stale with each contract
 * change.
 */
import type { BrowserContext } from '@playwright/test';
import path from 'node:path';

const DESCRIPTION = path.join(__dirname, '..', '..', 'projects', 'contract', 'openapi.json');

/** Answer the description from the committed file: registered last, so ahead of the recordings. */
export async function serveDescription(context: BrowserContext): Promise<void> {
  await context.route(/\/ContentService\/openapi\.json\/?(\?|$)/, (route) =>
    route.fulfill({ path: DESCRIPTION, contentType: 'application/json; charset=utf-8' })
  );
}
