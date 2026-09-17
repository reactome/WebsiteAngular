/**
 * Reduce the e2e recordings to what replay actually uses, and drop bodies that
 * nothing references.
 *
 * Run by `npm run e2e:record` after a recording, and safe to run on its own:
 *
 *     node scripts/trim-har.mjs
 */
import { readdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const HAR_DIR = path.join(import.meta.dirname, '..', 'e2e', 'har');

// Keep only what e2e/support/backend.ts actually reads back: the method and URL
// it matches on, and the status, headers and body it replays. Playwright records
// far more -- timings, cache state, request headers and cookies, sizes, page
// refs -- none of which is read, all of which is committed. Dropping the request
// side also means no header we did not look at can ride into a public repository.
const referenced = new Set();
let before = 0;
let after = 0;

for (const name of readdirSync(HAR_DIR).filter((f) => f.endsWith('.har'))) {
  const file = path.join(HAR_DIR, name);
  const raw = readFileSync(file, 'utf8');
  before += raw.length;

  const har = JSON.parse(raw);
  const entries = har.log.entries.map((entry) => {
    const body = entry.response?.content?._file;
    if (body) referenced.add(body);
    return {
      request: { method: entry.request.method, url: entry.request.url },
      response: {
        status: entry.response.status,
        headers: entry.response.headers ?? [],
        content: {
          mimeType: entry.response.content?.mimeType,
          ...(body ? { _file: body } : {}),
          ...(entry.response.content?.text !== undefined
            ? { text: entry.response.content.text, encoding: entry.response.content.encoding }
            : {}),
        },
      },
    };
  });

  const slim = JSON.stringify({ log: { version: har.log.version, entries } });
  writeFileSync(file, slim);
  after += slim.length;
}

let freed = 0;
let dropped = 0;
for (const name of readdirSync(HAR_DIR).filter((f) => f.endsWith('.json'))) {
  // `<test>.api.json` is a probe recording written by e2e/support/backend.ts, not
  // a response body, and no HAR references it. Without this it looked exactly
  // like an orphan and was deleted on every record -- silently removing the thing
  // that stops fourteen tests skipping themselves.
  if (name.endsWith('.api.json')) continue;
  if (referenced.has(name)) continue;
  const file = path.join(HAR_DIR, name);
  freed += statSync(file).size;
  unlinkSync(file);
  dropped += 1;
}

console.log(
  `\nTrimmed recordings to what replay reads: ${(before / 1024 / 1024).toFixed(1)} MB -> ` +
    `${(after / 1024 / 1024).toFixed(1)} MB.`
);
console.log(
  dropped
    ? `Pruned ${dropped} unreferenced response bodies (${(freed / 1024 / 1024).toFixed(1)} MB).`
    : 'No unreferenced response bodies to prune.'
);
