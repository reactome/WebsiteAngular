/**
 * Reduce the e2e recordings to what replay actually uses, and drop bodies that
 * nothing references.
 *
 * Run by `npm run e2e:record` after a recording, and safe to run on its own:
 *
 *     node scripts/trim-har.mjs
 */
import {
  existsSync,
  readdirSync,
  readFileSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { stripStubbed, stubsFile } from '../e2e/support/har-stubs.mjs';

const HAR_DIR = path.join(import.meta.dirname, '..', 'e2e', 'har');

// Keep only what e2e/support/backend.ts actually reads back: the method and URL
// it matches on, and the status, headers and body it replays. Playwright records
// far more -- timings, cache state, request headers and cookies, sizes, page
// refs -- none of which is read, all of which is committed. Dropping the request
// side also means no header we did not look at can ride into a public repository.
const referenced = new Set();
let before = 0;
let after = 0;
let stripped = 0;

for (const name of readdirSync(HAR_DIR).filter((f) => f.endsWith('.har'))) {
  const file = path.join(HAR_DIR, name);
  const raw = readFileSync(file, 'utf8');
  before += raw.length;

  const har = JSON.parse(raw);
  // The answers the test gave itself, noted while it was recorded: replay gets
  // them from the test again, and pooled they would answer other tests (#404).
  const stubs = stubsFile(file);
  let kept = har.log.entries;
  if (existsSync(stubs)) {
    kept = stripStubbed(kept, JSON.parse(readFileSync(stubs, 'utf8')));
    stripped += har.log.entries.length - kept.length;
    unlinkSync(stubs);
  }
  const entries = kept.map((entry) => {
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

// A note whose recording is gone -- a test renamed or removed, or a run killed
// before its context closed -- has nothing to apply to.
for (const name of readdirSync(HAR_DIR).filter((f) => f.endsWith('.stubs'))) {
  unlinkSync(path.join(HAR_DIR, name));
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
if (stripped) console.log(`Dropped ${stripped} answers the tests stubbed themselves.`);
console.log(
  dropped
    ? `Pruned ${dropped} unreferenced response bodies (${(freed / 1024 / 1024).toFixed(1)} MB).`
    : 'No unreferenced response bodies to prune.'
);
