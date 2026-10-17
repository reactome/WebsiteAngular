#!/usr/bin/env node
/**
 * Java-against-Java parity (spec 010, research R7): the same requests to a
 * reference -- what answers today -- and a candidate -- what replaces it --
 * compared on status, every response header but named noise, and the bytes
 * of the body after a declared normaliser.
 *
 * Over node:http, not fetch: fetch drops a Host set by the caller, so each
 * side saw its own address and every answer built from Host differed for a
 * reason that was not a difference; and fetch hides Transfer-Encoding.
 *
 * Reports carry digests and verdicts, never bodies -- some answers hold
 * people's records -- and errors carry only their kind, never a message,
 * which can quote a body. With --redact not even the request, because some
 * paths are tokens anyone holding them can read.
 *
 * Usage:
 *   node tools/java-parity/parity.mjs --reference URL --candidate URL \
 *     --requests requests.json [--normalise NAME] [--host HOST] [--timeout MS]
 *     [--ignore-header NAME]... [--calibrate] [--redact] [--simultaneous]
 * requests.json: [{ "method": "GET", "path": "/...", "headers": {},
 *                   "body": "text" | "bodyBase64": "..." | "bodyFile": "path" }]
 * Exit: 0 all identical; 1 differences; 2 errors, unstable requests, or
 * nothing compared -- a run that compared nothing is not a pass; 3 usage.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { brotliDecompressSync, gunzipSync, inflateSync } from 'node:zlib';
import { normalisers } from './normalisers.mjs';

/** Headers that differ between any two servers by nature, and only these. */
const NOISE = new Set(['date', 'connection', 'keep-alive', 'server']);

function requestBody({ body, bodyBase64, bodyFile }) {
  if (bodyFile) return readFileSync(bodyFile);
  if (bodyBase64) return Buffer.from(bodyBase64, 'base64');
  return body === undefined ? undefined : Buffer.from(body);
}

/**
 * A base URL as the place to send a path: scheme, host (an IPv6 one without
 * its brackets), port, and any context path, which is kept -- dropping it
 * sent both sides to the same wrong resource, whose matching 404s compared
 * as a pass. Anything it cannot honour is refused, never ignored.
 */
function baseOf(base) {
  const url = new URL(base);
  if (url.protocol !== 'http:' && url.protocol !== 'https:')
    throw new Error(`base must be http or https: ${url.protocol}`);
  if (url.search || url.hash) throw new Error('base must not carry a query or fragment');
  return {
    send: url.protocol === 'https:' ? httpsRequest : httpRequest,
    hostname: url.hostname.replace(/^\[(.*)\]$/, '$1'),
    port: url.port || (url.protocol === 'https:' ? 443 : 80),
    prefix: url.pathname.replace(/\/$/, ''),
  };
}

/**
 * Headers as sent: from rawHeaders, every copy kept and joined in order --
 * the parsed map keeps one Content-Type or Location of two, so a side that
 * sent two compared equal to one that sent one.
 */
function rawHeaders(raw) {
  const headers = {};
  for (let at = 0; at < raw.length; at += 2) {
    const name = raw[at].toLowerCase();
    headers[name] = name in headers ? `${headers[name]}, ${raw[at + 1]}` : raw[at + 1];
  }
  return headers;
}

const failure = (kind) => Object.assign(new Error(kind), { kind });

/** One answer: status, headers as sent, and the body as sent -- within `timeout` in all. */
function answer(base, req, { host, timeout }) {
  const { send, hostname, port, prefix } = baseOf(base);
  const body = requestBody(req);
  return new Promise((resolve, reject) => {
    const outgoing = send(
      {
        hostname,
        port,
        method: req.method ?? 'GET',
        path: `${prefix}${req.path}`,
        headers: {
          ...(req.headers ?? {}),
          ...(host ? { host } : {}),
          ...(body ? { 'content-length': body.length } : {}),
        },
      },
      (response) => {
        const chunks = [];
        response.on('data', (chunk) => chunks.push(chunk));
        response.on('end', () => {
          clearTimeout(timer);
          resolve({
            status: response.statusCode,
            headers: rawHeaders(response.rawHeaders),
            body: Buffer.concat(chunks),
          });
        });
        response.on('error', reject);
      }
    );
    // The whole request, not a silence: a body trickled a byte at a time
    // never goes quiet, and held the run open.
    const timer = setTimeout(() => outgoing.destroy(failure('timeout')), timeout);
    outgoing.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    outgoing.end(body);
  });
}

/** The body a client reads: Content-Encoding undone (the header itself is still compared). */
function decoded({ headers, body }) {
  const encoding = (headers['content-encoding'] ?? '').trim().toLowerCase();
  try {
    if (encoding === 'gzip') return gunzipSync(body);
    if (encoding === 'br') return brotliDecompressSync(body);
    if (encoding === 'deflate') return inflateSync(body);
  } catch {
    throw failure('body decoding');
  }
  return body;
}

/** A body through the normaliser; a body it cannot take is the normaliser's failure. */
function normalised(normalise, answer) {
  const body = decoded(answer);
  try {
    return normalise(body);
  } catch {
    throw failure('normaliser');
  }
}

const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');

/** What differs between two answers, bodies normalised the same way. */
function differences(a, b, normalise, ignored = new Set()) {
  const found = [];
  if (a.status !== b.status) found.push('status');
  const names = new Set([...Object.keys(a.headers), ...Object.keys(b.headers)]);
  for (const name of [...names].sort()) {
    if (NOISE.has(name) || ignored.has(name)) continue;
    // Content-Length follows the body; under a normaliser the body is compared instead.
    if (name === 'content-length' && normalise !== normalisers.identity) continue;
    if (a.headers[name] !== b.headers[name]) found.push(name);
  }
  // Different statuses are a difference whatever the bodies are: an error
  // page the normaliser cannot take must not turn that into an error.
  if (found.includes('status')) {
    if (digest(decoded(a)) !== digest(decoded(b))) found.push('body');
    return found;
  }
  if (digest(normalised(normalise, a)) !== digest(normalised(normalise, b))) found.push('body');
  return found;
}

/** Only the kind of a failure: a message can quote the body or the URL. */
const kindOf = (error) => error?.kind ?? (error?.code ? `network ${error.code}` : 'failed');

/**
 * Compare every request. With `calibrate`, the reference is asked again:
 * where it disagrees with itself (live third-party data), the request is
 * "unstable" and counted neither way.
 */
export async function compareAll(
  requests,
  {
    reference,
    candidate,
    normalise = normalisers.identity,
    host,
    timeout = 120_000,
    calibrate = false,
    redact = false,
    simultaneous = false,
    ignoreHeaders = [],
  }
) {
  // Refused before anything is sent: a base it cannot honour is a usage error.
  baseOf(reference);
  baseOf(candidate);
  const ignored = new Set(ignoreHeaders.map((name) => name.toLowerCase()));
  const results = [];
  const counts = { identical: 0, different: 0 };
  const count = (key) => (counts[key] = (counts[key] ?? 0) + 1);
  const ask = (base, req) => answer(base, req, { host, timeout });
  for (const [index, req] of requests.entries()) {
    const label = redact ? `#${index}` : `${req.method ?? 'GET'} ${req.path}`;
    try {
      const [ref, cand] = simultaneous
        ? await Promise.all([ask(reference, req), ask(candidate, req)])
        : [await ask(reference, req), await ask(candidate, req)];
      const result = { request: label, status: [ref.status, cand.status] };
      if (calibrate) {
        result.calibrated =
          differences(ref, await ask(reference, req), normalise, ignored).length === 0;
        if (!result.calibrated) {
          count('unstable');
          results.push(result);
          continue;
        }
      }
      result.differs = differences(ref, cand, normalise, ignored);
      count(result.differs.length ? 'different' : 'identical');
      results.push(result);
    } catch (error) {
      count('errors');
      results.push({ request: label, error: kindOf(error) });
    }
  }
  // A declared exclusion is part of the result, never silent.
  return { counts, ...(ignored.size ? { ignoredHeaders: [...ignored] } : {}), results };
}

/** The exit code a report earns: 0 only when something was compared and all of it was identical. */
export function verdict({ counts }) {
  if (counts.errors || counts.unstable || counts.identical + counts.different === 0) return 2;
  return counts.different ? 1 : 0;
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
      'usage: parity.mjs --reference URL --candidate URL --requests FILE [--normalise NAME] [--host HOST] [--timeout MS] [--ignore-header NAME]... [--calibrate] [--redact] [--simultaneous]'
    );
    process.exit(3);
  }
  const report = await compareAll(JSON.parse(readFileSync(option('requests'), 'utf8')), {
    reference: option('reference'),
    candidate: option('candidate'),
    normalise,
    host: option('host'),
    timeout: option('timeout') ? Number(option('timeout')) : undefined,
    calibrate: flag('calibrate'),
    redact: flag('redact'),
    simultaneous: flag('simultaneous'),
    ignoreHeaders: args.flatMap((arg, at) => (arg === '--ignore-header' ? [args[at + 1]] : [])),
  });
  console.log(JSON.stringify(report, null, 2));
  process.exit(verdict(report));
}
