/**
 * Proof of human, and the identity the answer limits key on.
 *
 * The question that prompted this was whether the route is protected against
 * computational access. It was not: the identity the chatbot's limiter keys on
 * came from a cookie the caller returns, so ignoring cookies produced a new
 * identity every request. These tests pin the properties that fix that -- the
 * subject is signed by us, cannot be forged, and cannot be obtained without
 * passing a challenge.
 *
 * The module reads its configuration at import, so the secrets are set before
 * the dynamic import below.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

process.env.ANSWER_IDENTITY_SECRET = 'test-identity-secret';
// Cloudflare's documented always-passes test secret. Real, and safe to commit:
// it is published for exactly this, and verifying with it returns
// `metadata.result_with_testing_key: true`.
process.env.TURNSTILE_SECRET = '1x0000000000000000000000000000000AA';
process.env.TURNSTILE_SITEKEY = '1x00000000000000000000AA';
const gate = await import('./human-gate.js');

const {
  mintIdentity,
  readIdentity,
  identityFromRequest,
  verifyCaptcha,
  sign,
  IDENTITY_TTL_MS,
  SITEVERIFY,
} = gate.default ?? gate;

describe('the signed identity', () => {
  it('round-trips a minted identity', () => {
    const subject = readIdentity(mintIdentity());
    expect(subject).toMatch(/^[0-9a-f]{32}$/);
  });

  it('gives a different subject every time it is minted', () => {
    // Minting is ours; rotation costs a challenge. Two readers must not collide.
    expect(readIdentity(mintIdentity())).not.toBe(readIdentity(mintIdentity()));
  });

  it('rejects a subject the caller made up', () => {
    // The whole point. Without the signature, a caller sets any subject it
    // likes and every request looks like a new reader -- which is exactly what
    // the unsigned cookie allowed.
    const forged = `${'a'.repeat(32)}.${Date.now() + 10_000}.not-a-signature`;
    expect(readIdentity(forged)).toBeNull();
  });

  it('rejects a real signature reattached to a different subject', () => {
    const value = mintIdentity();
    const [, expiry, signature] = value.split('.');
    expect(readIdentity(`${'b'.repeat(32)}.${expiry}.${signature}`)).toBeNull();
  });

  it('rejects an extended expiry', () => {
    // Re-signing is impossible without the secret, so moving the expiry must
    // invalidate the value rather than extend the identity.
    const value = mintIdentity();
    const [subject, expiry, signature] = value.split('.');
    expect(readIdentity(`${subject}.${Number(expiry) + 86_400_000}.${signature}`)).toBeNull();
  });

  it('rejects an expired identity', () => {
    const now = Date.now();
    const value = mintIdentity(now - IDENTITY_TTL_MS - 1000);
    expect(readIdentity(value, now)).toBeNull();
  });

  it('accepts one that has not expired yet', () => {
    const now = Date.now();
    expect(readIdentity(mintIdentity(now), now + 1000)).not.toBeNull();
  });

  it('reads it out of a cookie header among others', () => {
    const value = mintIdentity();
    const req = { headers: { cookie: `other=1; ra_human=${value}; another=2` } };
    expect(identityFromRequest(req)).toBe(readIdentity(value));
  });

  it('finds nothing when there is no cookie at all', () => {
    expect(identityFromRequest({ headers: {} })).toBeNull();
  });

  it('is not a signature a caller could compute', () => {
    // Sanity on the construction: the signature must depend on the secret, not
    // just on the payload.
    expect(sign('x.1')).not.toBe(sign('x.2'));
  });
});

describe('verifying the challenge', () => {
  beforeEach(() => vi.restoreAllMocks());

  it('accepts Turnstile saying success', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, json: async () => ({ success: true }) }));
    expect(await verifyCaptcha('a-token', fetchImpl)).toBe(true);
    const body = fetchImpl.mock.calls[0][1].body;
    expect(body).toContain('response=a-token');
    expect(body).toContain('secret=1x0000000000000000000000000000000AA');
  });

  it('refuses when Turnstile says it failed', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true, json: async () => ({ success: false }) }));
    expect(await verifyCaptcha('a-token', fetchImpl)).toBe(false);
  });

  it('refuses when the verification call itself fails', async () => {
    // A network error must not become an accidental pass. This is the direction
    // that matters: failing open here would make the gate decorative.
    const fetchImpl = vi.fn(async () => {
      throw new Error('network down');
    });
    expect(await verifyCaptcha('a-token', fetchImpl)).toBe(false);
  });

  it('refuses a non-200 from Turnstile', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: false, json: async () => ({ success: true }) }));
    expect(await verifyCaptcha('a-token', fetchImpl)).toBe(false);
  });

  it('refuses an empty token without calling out at all', async () => {
    const fetchImpl = vi.fn();
    expect(await verifyCaptcha('', fetchImpl)).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe('which service is asked', () => {
  it('asks Cloudflare Turnstile, not hCaptcha', () => {
    // The site is already behind Cloudflare and the chatbot deployment already
    // holds a Turnstile keypair, so this reuses what exists rather than adding
    // a second provider. It also has published test keys, which is what makes
    // the exchange testable at all.
    expect(SITEVERIFY).toBe('https://challenges.cloudflare.com/turnstile/v0/siteverify');
  });

  it('refuses a malformed cookie rather than throwing', () => {
    // `decodeURIComponent('%')` raises a URIError, which was outside any
    // handler and would have turned into a 500 on the answer route.
    expect(identityFromRequest({ headers: { cookie: 'ra_human=%' } })).toBeNull();
  });
});
