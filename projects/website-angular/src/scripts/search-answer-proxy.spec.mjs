/**
 * The caller token the answer proxy mints.
 *
 * Pins exactly what the chatbot verifies, because a token they refuse produces
 * `{"state": "refused"}` with HTTP 200 -- which looks identical to a refusal for
 * any other reason, and offers nothing to debug from.
 *
 * An ephemeral keypair is generated per test rather than reading the real
 * signing key: the test proves the shape and the signature, and has no business
 * touching a private key on disk.
 */
import { createRequire } from 'node:module';
import crypto from 'node:crypto';
import { beforeEach, describe, expect, it } from 'vitest';

// The proxy is CommonJS because the server that loads it is.
const require = createRequire(import.meta.url);
const {
  HUMAN_CLAIM_MAX_AGE_SECONDS,
  mintCallerToken,
  AUDIENCE,
  ISSUER,
  USER_AGENT,
  retryAfter,
  clientKey,
  LIMITS,
  GLOBAL_LIMIT,
  __resetLimits,
} = require('./search-answer-proxy.js');

function keypair() {
  return crypto.generateKeyPairSync('ed25519');
}

function parts(token) {
  const [header, payload, signature] = token.split('.');
  return {
    header: JSON.parse(Buffer.from(header, 'base64url')),
    payload: JSON.parse(Buffer.from(payload, 'base64url')),
    signature,
    signed: `${header}.${payload}`,
  };
}

describe('the caller token', () => {
  it('is an EdDSA JWT', () => {
    const { privateKey } = keypair();
    expect(parts(mintCallerToken(privateKey, 'abc')).header).toEqual({
      alg: 'EdDSA',
      typ: 'JWT',
    });
  });

  it('verifies against the public half of the signing key', () => {
    // The whole point of an asymmetric algorithm: they hold only this half and
    // cannot mint with it. A verifying key that could sign would give back
    // exactly what choosing EdDSA over HMAC bought.
    const { privateKey, publicKey } = keypair();
    const token = parts(mintCallerToken(privateKey, 'abc'));

    expect(
      crypto.verify(
        null,
        Buffer.from(token.signed),
        publicKey,
        Buffer.from(token.signature, 'base64url')
      )
    ).toBe(true);
  });

  it('does not verify against an unrelated key', () => {
    // Guards against the signature being absent, empty, or copied: a test that
    // only checks the happy path would pass on a token signed with anything.
    const token = parts(mintCallerToken(keypair().privateKey, 'abc'));
    const stranger = keypair().publicKey;

    expect(
      crypto.verify(
        null,
        Buffer.from(token.signed),
        stranger,
        Buffer.from(token.signature, 'base64url')
      )
    ).toBe(false);
  });

  it('carries the audience they enforce', () => {
    // They expect exactly this and refuse a token carrying anything else, or
    // none. Asking them to enforce it found a bug on their side, where no
    // audience was expected at all and PyJWT refused every token that had one.
    const { payload } = parts(mintCallerToken(keypair().privateKey, 'abc'));
    expect(payload.aud).toBe('reactome-chatbot');
    expect(AUDIENCE).toBe('reactome-chatbot');
  });

  it('expires, and soon, because it is minted per request', () => {
    const { payload } = parts(mintCallerToken(keypair().privateKey, 'abc'));
    expect(payload.exp - payload.iat).toBe(120);
    expect(payload.exp).toBeGreaterThan(Math.floor(Date.now() / 1000));
  });

  it('carries the caller subject their rate limiter keys on', () => {
    // Without `sub` they fall back to hashing the token, which changes every
    // request -- so each question in one reading session would count as a new
    // caller and no limit would ever bite.
    const { payload } = parts(mintCallerToken(keypair().privateKey, 'deadbeef'));
    expect(payload.sub).toBe('deadbeef');
    expect(payload.iss).toBe(ISSUER);
  });
});

describe('the presence claim', () => {
  const solvedAt = 1_700_000_000_000;

  it('says a person is present, and when they proved it', () => {
    // The chatbot refuses to summarise someone's uploaded identifiers without
    // this. It cannot read our identity cookie -- that is same-site to this
    // origin and they are reached from this server -- so the claim rides on the
    // token they already verify.
    const { payload } = parts(
      mintCallerToken(
        keypair().privateKey,
        'abc',
        { solvedAt, subject: 'the-cookie-subject' },
        solvedAt + 60_000
      )
    );
    expect(payload.human).toBe(true);
    expect(payload.human_iat).toBe(Math.floor(solvedAt / 1000));
    expect(payload.human_sub).toBe('the-cookie-subject');
  });

  it('keeps the cookie subject out of `sub`, which means something else', () => {
    // `sub` is whatever callerSubject decided; their answer endpoint's limiter
    // keys on it. `human_sub` is specifically the identity cookie's subject, so
    // their summary limiter can key on the durable one without either
    // endpoint's meaning depending on which branch callerSubject took.
    //
    // Not asserted: that the two are equal. They are today, and pinning that
    // would make the separation stop being real.
    const { payload } = parts(
      mintCallerToken(
        keypair().privateKey,
        'per-visit-id',
        { solvedAt, subject: 'the-cookie-subject' },
        solvedAt + 60_000
      )
    );
    expect(payload.sub).toBe('per-visit-id');
    expect(payload.human_sub).toBe('the-cookie-subject');
  });

  it('leaves the claim off at 1801 seconds', () => {
    // Thirty minutes, the same bound the other side enforces as
    // `now - human_iat <= 1800`. The cookie is still perfectly valid for twelve
    // hours; it is just no longer evidence that somebody is at the keyboard.
    const { payload } = parts(
      mintCallerToken(
        keypair().privateKey,
        'abc',
        { solvedAt, subject: 's' },
        solvedAt + (HUMAN_CLAIM_MAX_AGE_SECONDS + 1) * 1000
      )
    );
    expect('human' in payload).toBe(false);
    expect('human_iat' in payload).toBe(false);
  });

  it('keeps it at exactly 1800 seconds', () => {
    const { payload } = parts(
      mintCallerToken(
        keypair().privateKey,
        'abc',
        { solvedAt, subject: 's' },
        solvedAt + HUMAN_CLAIM_MAX_AGE_SECONDS * 1000
      )
    );
    expect(payload.human).toBe(true);
  });

  it('accepts 1800.4 seconds, because the claim only carries whole ones', () => {
    // The agreed precision rather than a discovered one. `human_iat` is epoch
    // seconds, so a sub-second difference cannot be expressed in the claim and
    // the other end cannot see it either. An earlier version of this test
    // pinned 1800.000 against 1800.001 and was measuring the harness.
    const { payload } = parts(
      mintCallerToken(
        keypair().privateKey,
        'abc',
        { solvedAt, subject: 's' },
        solvedAt + HUMAN_CLAIM_MAX_AGE_SECONDS * 1000 + 400
      )
    );
    expect(payload.human).toBe(true);
  });

  it('omits the claim rather than saying false when there is no identity', () => {
    // Absent and false are not the same to a verifier. `false` invites a check
    // that reads it as "not stated" and lets the call through; absent cannot be
    // read that way.
    const { payload } = parts(mintCallerToken(keypair().privateKey, 'abc'));
    expect('human' in payload).toBe(false);
    expect(payload.sub).toBe('abc');
  });
});

describe('the user agent', () => {
  it('identifies this service rather than a library', () => {
    // nginx blocks library-default agents at the edge before the request
    // reaches the chatbot: `python-httpx/0.27` gets a 403 with an HTML body,
    // which looks nothing like the contract and reads as a token fault. This
    // exists so deleting the header fails a test rather than an afternoon.
    expect(USER_AGENT).toContain('reactome-website');
    expect(USER_AGENT).not.toMatch(/node-fetch|undici|axios|httpx|python/i);
  });
});

describe('what stops a script spending money', () => {
  // Asked directly: "is the endpoint actually protected based on me being
  // human, free from computational access?" The honest answer was no -- and the
  // identifier the chatbot's own limiter keys on is the `sub` cookie, which the
  // caller returns, so a caller that ignores cookies presented a new one every
  // request and was never limited at all.
  //
  // These bound the cost. They are not a proof of human, and nothing here
  // pretends to be one.
  beforeEach(() => __resetLimits());

  it('lets a reader ask a few times and then asks them to wait', () => {
    const allowed = Array.from({ length: 10 }, () => retryAfter('198.51.100.7')).filter(
      (wait) => wait === 0
    ).length;
    expect(allowed).toBe(LIMITS[0].max);
  });

  it('tells the caller how long to wait, in seconds', () => {
    for (let i = 0; i < LIMITS[0].max; i += 1) retryAfter('198.51.100.8');
    const wait = retryAfter('198.51.100.8');
    expect(wait).toBeGreaterThan(0);
    expect(wait).toBeLessThanOrEqual(LIMITS[0].windowMs / 1000);
  });

  it('does not let one busy reader block another', () => {
    for (let i = 0; i < 20; i += 1) retryAfter('198.51.100.9');
    expect(retryAfter('203.0.113.4')).toBe(0);
  });

  it('bounds the total even when the address is forged fresh every time', () => {
    // The per-address key comes from a header, so a caller reaching the origin
    // directly can rotate it -- the same flaw as the cookie, one layer down.
    // The global cap is the part that actually holds.
    const allowed = Array.from({ length: GLOBAL_LIMIT.max * 2 }, (_, i) =>
      retryAfter(`forged-${i}`)
    ).filter((wait) => wait === 0).length;
    expect(allowed).toBe(GLOBAL_LIMIT.max);
  });

  it('lets a reader through again once their window has passed', () => {
    const now = Date.now();
    for (let i = 0; i < LIMITS[0].max; i += 1) retryAfter('198.51.100.10', now);
    expect(retryAfter('198.51.100.10', now)).toBeGreaterThan(0);
    expect(retryAfter('198.51.100.10', now + LIMITS[0].windowMs + 1)).toBe(0);
  });

  it('prefers the address Cloudflare sets over one the caller sent', () => {
    expect(
      clientKey({
        headers: { 'cf-connecting-ip': '9.9.9.9', 'x-forwarded-for': '1.1.1.1' },
        socket: {},
      })
    ).toBe('9.9.9.9');
  });

  it('takes the left-most forwarded address, which is the client', () => {
    expect(
      clientKey({ headers: { 'x-forwarded-for': '1.1.1.1, 2.2.2.2, 3.3.3.3' }, socket: {} })
    ).toBe('1.1.1.1');
  });
});
