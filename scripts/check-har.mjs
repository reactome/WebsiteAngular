/**
 * Check the e2e recordings for backend answers a replay would get wrong.
 *
 * A response cut off after its headers is recorded as a 200 with no body.
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
import { pathToFileURL } from 'node:url';
import { BACKEND, isCutOff, isTruncated, isUsable } from '../e2e/support/har-entry.mjs';

const HAR_DIR = path.join(import.meta.dirname, '..', 'e2e', 'har');

/** `METHOD /path?query`, as the harness keys a request. */
function key(entry) {
  const u = new URL(entry.request.url);
  return `${entry.request.method.toUpperCase()} ${u.pathname}${u.search}`;
}

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
    const { truncated, cutOff } = problems(
      JSON.parse(readFileSync(path.join(HAR_DIR, name), 'utf8'))
    );
    cutOffs += cutOff.length;
    if (truncated.length === 0) continue;
    failed += truncated.length;
    console.error(
      `${name}\n${truncated.map((k) => `  cut off after its headers: ${k}`).join('\n')}`
    );
  }
  console.log(
    `${cutOffs} requests were still in flight when their test ended (replayed as aborted).`
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

if (import.meta.url === pathToFileURL(process.argv[1]).href) main();
