// What a recorded response is fit to replay as. Shared by the replay harness
// (e2e/support/backend.ts) and the recordings check (scripts/check-har.mjs), so
// the two cannot disagree about what counts as a usable recording.

/**
 * Everything this site treats as "the backend", and so records and replays.
 * The reasoning for each part is beside its use in e2e/support/backend.ts.
 */
export const BACKEND =
  /\/(ContentService|AnalysisService|ExperimentDigester)\/[^?#]|idg\.reactome\.org/;

/**
 * @typedef {{
 *   request: { method: string; url: string };
 *   response: {
 *     status: number;
 *     headers?: { name: string; value: string }[];
 *     content?: { text?: string; encoding?: string; mimeType?: string; _file?: string };
 *   };
 * }} HarEntry
 */

/** Whether the recording kept a body for this response, inline or beside it. */
export function hasBody(/** @type {HarEntry} */ entry) {
  const c = entry.response.content ?? {};
  return Boolean(c._file) || (c.text !== undefined && c.text !== '');
}

/**
 * A response recorded before it finished: its headers promised a body and none
 * was kept. Playwright writes such a request as a 200 when the page closes
 * mid-stream. Replayed, it would be a *successful empty* response -- something
 * the server never sent -- and the app shows "nothing here" without a word.
 */
export function isTruncated(/** @type {HarEntry} */ entry) {
  const { status } = entry.response;
  if (status < 200 || status >= 300 || status === 204 || hasBody(entry)) return false;
  const length = (entry.response.headers ?? []).find(
    (h) => h.name.toLowerCase() === 'content-length'
  );
  return Number(length?.value ?? 0) > 0;
}

/**
 * Never answered at all -- still in flight when the page moved on. Replayed as
 * an aborted request, which is what happened to it when it was recorded.
 */
export function isCutOff(/** @type {HarEntry} */ entry) {
  return entry.response.status < 100;
}

/** A response a replay can serve as what the server said. */
export function isUsable(/** @type {HarEntry} */ entry) {
  return !isCutOff(entry) && !isTruncated(entry);
}
