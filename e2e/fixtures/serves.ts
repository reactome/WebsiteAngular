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
  let response;
  try {
    response = await request.get(url, { timeout });
  } catch (error) {
    // Nothing listening is genuinely "absent": CI proxies /RenderService to
    // 127.0.0.1:4310 and runs no render service, so the connection is refused
    // and those tests should stand down.
    //
    // A timeout is not. That is the case this helper exists for -- a request
    // that never answered used to read as a missing feature, and two identical
    // runs against beta skipped 12 tests and then 7 without saying so.
    const message = error instanceof Error ? error.message : String(error);
    if (/timed?\s?out|Timeout/i.test(message)) throw error;
    return false;
  }

  const status = response.status();
  // 404/501: the backend does not implement it. 502/503/504: a proxy could not
  // reach it, which on a dev server means it is not running.
  if ([404, 501, 502, 503, 504].includes(status)) return false;
  if (!response.ok()) {
    throw new Error(
      `${url} answered ${status}. A probe may only skip a test when the endpoint is absent; ` +
        `any other failure is worth seeing rather than skipping past.`
    );
  }
  return true;
}
