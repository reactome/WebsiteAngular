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
    // A timeout is the one failure that must not read as "absent". That was the
    // whole bug: two identical runs against beta skipped 12 tests and then 7,
    // because a slow request looked exactly like a missing feature.
    //
    // Anything else thrown here is the connection not being made at all, which
    // is absent by any useful definition.
    const message = error instanceof Error ? error.message : String(error);
    if (/timed?\s?out|Timeout/i.test(message)) throw error;
    return false;
  }

  // Any answer that is not success means the target cannot serve this, so the
  // test stands down. Enumerating "absent" status codes was tried and was wrong
  // twice over: 404/501 alone missed the dev-server proxy, which answers 500
  // when it cannot reach its target -- while the same proxy on another machine
  // answers 200 from the SPA fallback for the same condition.
  //
  // A service that is present but broken is caught by the test that runs
  // against it, not by the probe in front of it. The probe answers one question:
  // can this target serve this endpoint right now.
  return response.ok();
}
