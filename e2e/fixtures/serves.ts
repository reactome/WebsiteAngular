import type { APIRequestContext } from '@playwright/test';

/**
 * Whether the target backend implements an endpoint.
 *
 * Probes exist so a test can stand down where the target genuinely cannot
 * support it: a backend with no render service, a host with no icon library.
 * They must not turn a timeout or a 500 into "absent" -- that drops coverage
 * silently and still reports the run green.
 *
 * It was not hypothetical. Two identical runs of the same suite against beta
 * skipped 12 tests and then 7. The five that vanished were the reaction-page
 * checks, whose probe returns 200 when asked directly; the machine was simply
 * busy, `.catch(() => null)` swallowed it, and the summary said green both
 * times.
 *
 * So only 404 and 501 mean absent. Anything else throws, and the test fails
 * naming the status -- which is the right outcome for a backend that is broken
 * rather than missing.
 */
export async function serves(
  request: APIRequestContext,
  url: string,
  { timeout = 30_000 }: { timeout?: number } = {}
): Promise<boolean> {
  const response = await request.get(url, { timeout });
  if (response.status() === 404 || response.status() === 501) return false;
  if (!response.ok()) {
    throw new Error(
      `${url} answered ${response.status()}. A probe may only skip a test when the endpoint ` +
        `is absent (404/501); any other failure is worth seeing rather than skipping past.`
    );
  }
  return true;
}
