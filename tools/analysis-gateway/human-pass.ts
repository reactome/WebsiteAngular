/**
 * The site's human pass, checked here before a report is made (spec 031, User
 * Story 4, research R6).
 *
 * The site gives a reader who passed its human check (Cloudflare Turnstile) a
 * signed cookie, `ra_human`: `<subject>.<expiry>.<signature>`, the signature an
 * HMAC-SHA256 of `<subject>.<expiry>` with the site's identity secret, in
 * base64url (projects/website-angular/src/scripts/human-gate.js, mintIdentity).
 * This is a twin of that file's readIdentity, as content-node's turnstile.ts is
 * of its verifyCaptcha: the gateway's image carries tools/analysis-gateway
 * alone. The two must agree; human-pass.spec.ts checks this against a cookie
 * human-gate.js mints.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';

/** The cookie the site sets once its reader passes the human check. */
export const HUMAN_COOKIE = 'ra_human';

/** A request's pass: none given, one that is not good, or a good one. */
export type HumanPass = 'missing' | 'invalid' | 'valid';

/** The `ra_human` cookie's value in a Cookie header, or null. */
function cookieValue(header: string | undefined): string | null {
  const match = new RegExp(`(?:^|;\\s*)${HUMAN_COOKIE}=([^;]+)`).exec(header ?? '');
  return match?.[1] ?? null;
}

/**
 * Whether a Cookie header holds a good pass: signed with `secret`, and not
 * expired at `now`. Compared in constant time, so a caller cannot learn a
 * signature byte by byte from the time the answer takes. An empty secret makes
 * every pass invalid: the caller refuses before asking (FR-020).
 */
export function humanPass(
  cookieHeader: string | undefined,
  secret: string,
  now: number = Date.now()
): HumanPass {
  const value = cookieValue(cookieHeader);
  if (value === null) return 'missing';
  if (secret === '') return 'invalid';
  const [subject, expiry, signature, ...rest] = value.split('.');
  if (!subject || !expiry || !signature || rest.length > 0) return 'invalid';
  const expected = Buffer.from(
    createHmac('sha256', secret).update(`${subject}.${expiry}`).digest('base64url')
  );
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return 'invalid';
  if (!/^\d+$/.test(expiry) || Number(expiry) < now) return 'invalid';
  return 'valid';
}

/** Where the deployment mounts the site's answer settings, read for one line only. */
export const IDENTITY_FILE = '/run/secrets/answer.env';

/**
 * The site's identity secret: `ANSWER_IDENTITY_SECRET` from the environment, or
 * that one line of the settings file the site's own service reads, mounted at
 * IDENTITY_FILE (spec 031, T022). Nothing else in the file is read or kept.
 * Neither: empty, and no report is made (FR-020).
 */
export function identitySecretOf(
  env: Record<string, string | undefined>,
  file: string = IDENTITY_FILE
): string {
  const given = env['ANSWER_IDENTITY_SECRET'];
  if (given) return given;
  let text: string;
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    return '';
  }
  for (const line of text.split('\n')) {
    const match = /^\s*(?:export\s+)?ANSWER_IDENTITY_SECRET\s*=\s*(.*?)\s*$/.exec(line);
    if (match) return (match[1] ?? '').replace(/^(['"])(.*)\1$/, '$2');
  }
  return '';
}
