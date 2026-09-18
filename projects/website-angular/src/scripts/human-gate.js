/**
 * Proof of human for the answer route, and the identity the limits key on.
 *
 * The problem this solves, asked plainly and answered honestly first: nothing
 * about the answer route required a human. The caller identity the chatbot's
 * rate limiter uses came from a cookie *we set and the browser returns*, so a
 * caller that ignored cookies presented a new identity every request and was
 * never limited. Per-address limits have the same weakness one layer down,
 * because the address comes from a header a direct caller can forge.
 *
 * The fix is to make a fresh identity cost something. A reader solves the
 * captcha once; we verify it with hCaptcha server-side and mint a **signed**
 * identity cookie. The signature is what matters: the subject is chosen by us,
 * not by the caller, so it cannot be rotated or forged. To get a new bucket you
 * must solve another captcha.
 *
 * What this does and does not give you:
 *
 *   * A script cannot get an identity without solving a challenge.
 *   * A human who hands their token to a script is still bounded, because the
 *     limit follows the identity -- they burn their own allowance.
 *   * It is not unbypassable. Captcha-solving services exist. It converts free
 *     automation into paid automation with a per-identity ceiling, which is the
 *     realistic goal.
 *
 * **It refuses to run half-configured.** A gate that cannot verify must not
 * quietly wave callers through -- that is the shape of failure that looks like
 * protection and is not. If the gate is required and no secret is present, the
 * route answers 503 rather than becoming decorative.
 */
const crypto = require('node:crypto');

/** hCaptcha's verification endpoint. */
const SITEVERIFY = process.env.HCAPTCHA_VERIFY_URL || 'https://api.hcaptcha.com/siteverify';

/**
 * The secret that pairs with the sitekey the search page renders.
 *
 * Not in this repository, and not derivable from anything in it: the public
 * site's contact form posts its response to ContentService, so Tomcat holds
 * this today. It comes from the environment or the gate does not run.
 */
const HCAPTCHA_SECRET = process.env.HCAPTCHA_SECRET || '';

/**
 * Whether a verified human is required.
 *
 * Explicit rather than inferred from the secret being present. Inferring it
 * would mean a deployment that lost its secret silently stopped requiring
 * humans, which is exactly the failure this file exists to avoid.
 */
const REQUIRE_HUMAN = process.env.ANSWER_REQUIRE_HUMAN === '1';

/** How long one verification lasts before the reader is asked again. */
const IDENTITY_TTL_MS = 12 * 60 * 60 * 1000;

const COOKIE = 'ra_human';

/**
 * The key that signs identity cookies.
 *
 * Separate from the caller-token signing key: that one is an Ed25519 private
 * half the chatbot verifies, and it has no business being reused for our own
 * cookies. Absent, identities cannot be minted, which the gate treats as
 * not-configured rather than as permission.
 */
const IDENTITY_SECRET = process.env.ANSWER_IDENTITY_SECRET || '';

function sign(payload) {
  return crypto.createHmac('sha256', IDENTITY_SECRET).update(payload).digest('base64url');
}

/** `<subject>.<expiry>.<signature>` */
function mintIdentity(now = Date.now()) {
  const subject = crypto.randomBytes(16).toString('hex');
  const payload = `${subject}.${now + IDENTITY_TTL_MS}`;
  return `${payload}.${sign(payload)}`;
}

/**
 * The verified subject in a cookie value, or null.
 *
 * Constant-time comparison, so a caller cannot learn a valid signature one byte
 * at a time from response timing.
 */
function readIdentity(value, now = Date.now()) {
  if (!IDENTITY_SECRET || typeof value !== 'string') return null;
  const [subject, expiry, signature] = value.split('.');
  if (!subject || !expiry || !signature) return null;

  const expected = Buffer.from(sign(`${subject}.${expiry}`));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !crypto.timingSafeEqual(expected, given)) return null;
  if (!/^\d+$/.test(expiry) || Number(expiry) < now) return null;
  return subject;
}

function identityFromRequest(req, now = Date.now()) {
  const match = new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`).exec(req.headers?.cookie || '');
  if (!match) return null;
  let value;
  try {
    value = decodeURIComponent(match[1]);
  } catch {
    // `decodeURIComponent('%')` throws a URIError, so a cookie of `ra_human=%`
    // would have thrown out of here and turned into a 500 on the answer route.
    // A malformed cookie is simply not an identity.
    return null;
  }
  return readIdentity(value, now);
}

/**
 * Asks hCaptcha whether a response token is genuine.
 *
 * Failure of any kind is a failed verification. A network error here must not
 * become an accidental pass.
 */
async function verifyCaptcha(token, fetchImpl = fetch) {
  if (!HCAPTCHA_SECRET || typeof token !== 'string' || token === '') return false;
  try {
    const response = await fetchImpl(SITEVERIFY, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ secret: HCAPTCHA_SECRET, response: token }).toString(),
    });
    if (!response.ok) return false;
    const body = await response.json();
    return body?.success === true;
  } catch {
    return false;
  }
}

/** True when the gate is on but cannot possibly work. */
function misconfigured() {
  return REQUIRE_HUMAN && (!HCAPTCHA_SECRET || !IDENTITY_SECRET);
}

function setIdentityCookie(res, value) {
  res.append(
    'Set-Cookie',
    `${COOKIE}=${value}; Path=/; Max-Age=${Math.floor(IDENTITY_TTL_MS / 1000)}; HttpOnly; SameSite=Lax; Secure`
  );
}

module.exports = {
  COOKIE,
  IDENTITY_TTL_MS,
  REQUIRE_HUMAN,
  identityFromRequest,
  mintIdentity,
  misconfigured,
  readIdentity,
  setIdentityCookie,
  sign,
  verifyCaptcha,
};
