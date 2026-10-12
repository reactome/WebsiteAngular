/**
 * A test's own stubbed answers, kept out of the recordings (#404).
 *
 * Playwright records every response a test receives, including the ones its own
 * `page.route` handlers fulfil. Replay pools every recording as the fallback for
 * a request a test did not record itself, first copy wins, so an error test's
 * made-up 500 became the answer other tests got for the same real request.
 * Replay does not need a stubbed answer: the stub is still in the test, and
 * answers again.
 *
 * While recording, e2e/support/backend.ts notes which requests a test answered
 * itself and writes them beside its recording (`stubsFile`). The trim that
 * follows every recording (scripts/trim-har.mjs) drops those entries.
 */

/**
 * A request as replay keys it: method, path and query; the origin varies by run.
 * @param {string} method
 * @param {string} url
 * @returns {string}
 */
export function harKey(method, url) {
  const u = new URL(url);
  return `${method.toUpperCase()} ${u.pathname}${u.search}`;
}

/**
 * The note of a recording's stubbed requests, beside the recording.
 * @param {string} har
 * @returns {string}
 */
export function stubsFile(har) {
  return har.replace(/\.har$/, '.stubs');
}

/**
 * The requests a test answered every time itself.
 *
 * One that also went to the server is left alone: its recorded copies cannot be
 * told apart, and dropping the real one would leave replay with nothing to give.
 *
 * @param {Map<string, number>} asked how often each request was made
 * @param {Map<string, number>} fulfilled how often the test's own stubs answered it
 * @returns {string[]}
 */
export function fullyStubbed(asked, fulfilled) {
  return [...fulfilled]
    .filter(([key, times]) => times >= (asked.get(key) ?? 0))
    .map(([key]) => key);
}

/**
 * The entries left once the stubbed requests' are dropped.
 * @template {{ request: { method: string, url: string } }} E
 * @param {E[]} entries
 * @param {string[]} keys
 * @returns {E[]}
 */
export function stripStubbed(entries, keys) {
  if (!keys.length) return entries;
  const stubbed = new Set(keys);
  return entries.filter((entry) => !stubbed.has(harKey(entry.request.method, entry.request.url)));
}
