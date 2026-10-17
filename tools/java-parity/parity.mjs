#!/usr/bin/env node
/**
 * Java-against-Java parity (spec 010, research R7): the same requests to a
 * reference -- what answers today -- and a candidate -- what replaces it --
 * compared on status, the headers clients read, and the bytes of the body
 * after a declared normaliser.
 *
 * Reports carry digests and verdicts, never bodies: some answers hold
 * people's records, and with --redact not even the request, because some
 * paths are tokens anyone holding them can read.
 *
 * Usage:
 *   node tools/java-parity/parity.mjs --reference URL --candidate URL \
 *     --requests requests.json [--normalise NAME] [--calibrate] [--redact] [--simultaneous]
 * requests.json: [{ "method": "GET", "path": "/ContentService/...", "headers": {}, "body": "..." }]
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { normalisers } from './normalisers.mjs';

/** The headers a client reads; the rest (Date, Server, Connection) differ by nature. */
// fetch decodes a Content-Encoding alike on both sides; the header itself is
// still compared. A gzip *file* (a download) arrives as its bytes.
const COMPARED_HEADERS = [
  'content-type',
  'content-disposition',
  'content-length',
  'content-encoding',
  'access-control-allow-origin',
  'cache-control',
];

async function answer(base, { method = 'GET', path, headers = {}, body }) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers,
    body,
    // A redirect is an answer to compare, not one to follow.
    redirect: 'manual',
  });
  return {
    status: response.status,
    headers: Object.fromEntries(COMPARED_HEADERS.map((name) => [name, response.headers.get(name)])),
    body: Buffer.from(await response.arrayBuffer()),
  };
}

const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');

/** What differs between two answers, after normalising both bodies the same way. */
function differences(a, b, normalise) {
  const found = [];
  if (a.status !== b.status) found.push('status');
  for (const name of COMPARED_HEADERS) {
    // Content-Length follows the body; a normalised body is compared instead.
    if (name === 'content-length' && normalise !== normalisers.identity) continue;
    if (a.headers[name] !== b.headers[name]) found.push(name);
  }
  if (digest(normalise(a.body)) !== digest(normalise(b.body))) found.push('body');
  return found;
}

/**
 * Compare every request. With `calibrate`, the reference is first asked
 * twice: where it disagrees with itself (live third-party data), the request
 * is "unstable" and not counted either way.
 */
export async function compareAll(
  requests,
  {
    reference,
    candidate,
    normalise = normalisers.identity,
    calibrate = false,
    redact = false,
    simultaneous = false,
  }
) {
  const results = [];
  const counts = { identical: 0, different: 0 };
  for (const [index, request] of requests.entries()) {
    const label = redact ? `#${index}` : `${request.method ?? 'GET'} ${request.path}`;
    const [ref, cand] = simultaneous
      ? await Promise.all([answer(reference, request), answer(candidate, request)])
      : [await answer(reference, request), await answer(candidate, request)];
    const result = { request: label, status: [ref.status, cand.status] };
    if (calibrate) {
      const again = await answer(reference, request);
      result.calibrated = differences(ref, again, normalise).length === 0;
      if (!result.calibrated) {
        counts.unstable = (counts.unstable ?? 0) + 1;
        results.push(result);
        continue;
      }
    }
    result.differs = differences(ref, cand, normalise);
    counts[result.differs.length ? 'different' : 'identical'] += 1;
    results.push(result);
  }
  return { counts, results };
}

// Started directly rather than imported by a test.
if (process.argv[1] && process.argv[1].endsWith('parity.mjs')) {
  const args = process.argv.slice(2);
  const option = (name) => {
    const at = args.indexOf(`--${name}`);
    return at === -1 ? undefined : args[at + 1];
  };
  const flag = (name) => args.includes(`--${name}`);
  const normalise = normalisers[option('normalise') ?? 'identity'];
  if (!option('reference') || !option('candidate') || !option('requests') || !normalise) {
    console.error(
      'usage: parity.mjs --reference URL --candidate URL --requests FILE [--normalise NAME] [--calibrate] [--redact] [--simultaneous]'
    );
    process.exit(2);
  }
  const report = await compareAll(JSON.parse(readFileSync(option('requests'), 'utf8')), {
    reference: option('reference'),
    candidate: option('candidate'),
    normalise,
    calibrate: flag('calibrate'),
    redact: flag('redact'),
    simultaneous: flag('simultaneous'),
  });
  console.log(JSON.stringify(report, null, 2));
  process.exit(report.counts.different ? 1 : 0);
}
