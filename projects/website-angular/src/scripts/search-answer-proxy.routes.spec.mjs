/**
 * What the summary route does before it forwards anything.
 *
 * The gate used to ask only "has this browser ever proved itself", which the
 * twelve-hour identity cookie answers. The endpoint behind it asks something
 * narrower -- "is somebody there now" -- and refuses `no_human` without a
 * presence claim under thirty minutes old. So a reader who verified earlier in
 * the day was forwarded, refused, and shown a sentence telling them to go and
 * use the answer panel on the search page: a dead end reached through no fault
 * of theirs, roughly every time.
 *
 * Measured rather than reasoned: a caller token with no presence claim gets a
 * full answer from /api/answer and `{"state":"refused","reason":"no_human"}`
 * from /api/analysis-summary. That asymmetry is why this applies to one route
 * and not both -- challenging on the answer route would refuse callers the
 * upstream would have served.
 *
 * The module reads its configuration at import, so the environment is set
 * before the require below.
 */
import { createRequire } from 'node:module';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';

process.env.ANSWER_IDENTITY_SECRET = 'test-identity-secret';
process.env.TURNSTILE_SECRET = '1x0000000000000000000000000000000AA';
process.env.TURNSTILE_SITEKEY = '1x00000000000000000000AA';
process.env.SUMMARY_UPSTREAM = 'https://upstream.invalid/api/analysis-summary';

// An ephemeral key written to a temp file, for the same reason the caller-token
// spec generates its own: these tests prove which requests get forwarded, and
// have no business reading the real signing key off this machine. Left unset,
// the module falls back to ~/.reactome and would do exactly that.
const keyFile = path.join(os.tmpdir(), `reactome-test-caller-${process.pid}.pem`);
fs.writeFileSync(
  keyFile,
  crypto.generateKeyPairSync('ed25519').privateKey.export({ type: 'pkcs8', format: 'pem' })
);
process.env.CALLER_TOKEN_KEY = keyFile;

const require = createRequire(import.meta.url);
const express = require('express');
const gate = require('./human-gate.js');
const {
  mountAnalysisSummaryProxy,
  HUMAN_CLAIM_MAX_AGE_SECONDS,
  presenceIsFresh,
  __resetLimits,
} = require('./search-answer-proxy.js');

const THIRTY_MINUTES_MS = HUMAN_CLAIM_MAX_AGE_SECONDS * 1000;

/** A signed cookie whose challenge was solved `agoMs` ago. */
function cookieSolved(agoMs) {
  return `ra_human=${encodeURIComponent(gate.mintIdentity(Date.now() - agoMs))}`;
}

let server;
let base;

beforeEach(async () => {
  __resetLimits?.();
  const app = express();
  mountAnalysisSummaryProxy(app);
  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  base = `http://127.0.0.1:${server.address().port}/analysis-summary`;
});

afterAll(() => fs.rmSync(keyFile, { force: true }));

afterEach(async () => {
  await new Promise((resolve) => server.close(resolve));
});

const ask = (cookie) =>
  fetch(base, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
    body: JSON.stringify({ token: 'MjAyNjA5MTUxMjAwMDBfMQ==', disclosure: 'aggregate' }),
  });

describe('the check the summary route asks for', () => {
  it('challenges a caller who has never proved anything', async () => {
    const response = await ask();
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({ sitekey: expect.any(String) });
  });

  it('challenges a live cookie whose challenge has gone stale, rather than forwarding it', async () => {
    // The reported bug. The cookie is perfectly valid -- it lives twelve hours
    // -- so the old gate forwarded this, the endpoint refused `no_human`, and
    // the reader was told to go and use the answer panel on another page.
    const response = await ask(cookieSolved(THIRTY_MINUTES_MS + 60_000));
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      sitekey: '1x00000000000000000000AA',
      verify: '/search-answer/verify',
    });
  });

  it('forwards a cookie whose challenge is still fresh', async () => {
    // The other half, and the reason this is not just "challenge everybody".
    // `SUMMARY_UPSTREAM` is deliberately unresolvable, so a 502 here is the
    // observable proof that the route tried to reach it -- which is what
    // distinguishes forwarding from challenging without stubbing anything the
    // request itself travels over.
    const response = await ask(cookieSolved(60_000));
    expect(response.status).toBe(502);
  });
});

describe('the freshness rule the gate and the claim share', () => {
  it('accepts a challenge solved just now', () => {
    expect(presenceIsFresh({ solvedAt: Date.now(), subject: 'x' })).toBe(true);
  });

  it('accepts one solved at exactly the bound', () => {
    expect(presenceIsFresh({ solvedAt: Date.now() - THIRTY_MINUTES_MS })).toBe(true);
  });

  it('refuses one a second past it', () => {
    expect(presenceIsFresh({ solvedAt: Date.now() - THIRTY_MINUTES_MS - 1000 })).toBe(false);
  });

  it('refuses a challenge solved in the future, which is a clock and not a person', () => {
    expect(presenceIsFresh({ solvedAt: Date.now() + 60_000 })).toBe(false);
  });

  it('refuses the absence of one', () => {
    expect(presenceIsFresh(null)).toBe(false);
  });
});
