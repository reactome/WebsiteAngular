/**
 * Check the e2e recordings for backend answers a replay would get wrong.
 *
 * A response cut off mid-stream is recorded as a 200 with no body.
 * Replayed, it was a successful *empty* answer the server never gave, and the
 * page quietly showed nothing -- one test skipped itself for weeks on an empty
 * ancestors list. The harness now aborts such a request instead; this refuses
 * a recording that has one with no complete copy beside it, so a test cannot
 * come to depend on an answer its recording does not have.
 *
 * Requests still in flight when a test ended (status below 100) are reported,
 * not refused: they replay as aborted, which is faithful, and most are lookups
 * a test never needed. The count is here so it can be seen to move.
 *
 * Run after every recording, and in CI:
 *
 *     node scripts/check-har.mjs
 */
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { isEntry } from './is-entry.mjs';
import { harKey } from '../e2e/support/har-stubs.mjs';
import { BACKEND, isCutOff, isTruncated, isUsable } from '../e2e/support/har-entry.mjs';

const HAR_DIR = path.join(import.meta.dirname, '..', 'e2e', 'har');

/**
 * Answers the *app* abandons mid-stream, which a recording therefore always
 * catches cut off. The harness never replays them as empty: a request falls to
 * another test's complete copy if one exists, and is aborted if not -- either
 * way what the page saw. So they are listed, each pinned to its recording and
 * with why, rather than refused. Keep this short: anything not here is a test
 * ending too soon, and gets re-recorded instead.
 */
const ABANDONED = [
  {
    recording: /^legacy-links--legacy-pathway-links-/,
    // The pathways these tests open, by dbId or stable id, and the hierarchy.
    request:
      /\/data\/(query\/enhanced\/v2\/(R-HSA-)?(1280218|202733)\?|event\/(R-HSA-)?(1280218|202733)\/ancestors|detail\/R-HSA-(1280218|202733)\/locationsInPWB|eventsHierarchy\/9606\?)/,
    why: 'each test backs out of the pathway browser while the pathway is still loading, and a dbId is swapped for its stable id mid-load',
  },
  {
    recording: /^legacy-links--legacy-fragments-that-are-only-settings-diagram-dbid-/,
    request: /\/data\/query\/enhanced\/v2\/9006934\?/,
    why: 'the page swaps the dbId for its stable id mid-load',
  },
  {
    recording:
      /^diagram-load-errors--the-analysis-overlay-(says-so-when-the-pathway-s-results-can|a-hit-pathway-s-matches-say-so-when-th)/,
    request: /\/AnalysisService\/token\/[^/]+\/filter\/pathways\?/,
    why: 'the overlay forkJoins it with found/all, which the test fails; that unsubscribes this mid-stream',
  },
];

const abandoned = (recording, request) =>
  ABANDONED.some((a) => a.recording.test(recording) && a.request.test(request));

/** `METHOD /path?query`, as the harness keys a request. */
const key = (entry) => harKey(entry.request.method, entry.request.url);

/**
 * The backend requests in one recording that a replay cannot answer truly.
 * @param {{ log: { entries: import('../e2e/support/har-entry.mjs').HarEntry[] } }} har
 */
export function problems(har) {
  const byKey = new Map();
  for (const entry of har.log.entries) {
    if (!BACKEND.test(entry.request.url)) continue;
    const k = key(entry);
    byKey.set(k, [...(byKey.get(k) ?? []), entry]);
  }
  const truncated = [];
  const cutOff = [];
  for (const [k, entries] of byKey) {
    if (entries.some(isUsable)) continue;
    if (entries.some(isTruncated)) truncated.push(k);
    else if (entries.every(isCutOff)) cutOff.push(k);
  }
  return { truncated, cutOff };
}

function main() {
  let failed = 0;
  let cutOffs = 0;
  for (const name of readdirSync(HAR_DIR)
    .filter((f) => f.endsWith('.har'))
    .sort()) {
    const found = problems(JSON.parse(readFileSync(path.join(HAR_DIR, name), 'utf8')));
    const truncated = found.truncated.filter((k) => !abandoned(name, k));
    // Abandoned answers count with the cut-offs: never replayed as empty.
    cutOffs += found.cutOff.length + (found.truncated.length - truncated.length);
    if (truncated.length === 0) continue;
    failed += truncated.length;
    console.error(
      `${name}\n${truncated.map((k) => `  cut off after its headers: ${k}`).join('\n')}`
    );
  }
  console.log(
    `${cutOffs} requests were still in flight when their test ended (never replayed as empty).`
  );
  if (failed) {
    console.error(
      `\n${failed} recorded answers were cut off after their headers and have no complete copy.\n` +
        'Re-record those tests, keeping each one open until its requests finish.'
    );
    process.exit(1);
  }
  console.log('No recording has an answer cut off after its headers.');
}

if (isEntry(import.meta.url)) main();
