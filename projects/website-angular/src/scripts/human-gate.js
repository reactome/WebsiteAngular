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

/**
 * Cloudflare Turnstile rather than hCaptcha.
 *
 * Cloudflare already fronts this site, the chatbot deployment already holds a
 * keypair for it, and -- the part that mattered most here -- Turnstile publishes
 * **test keys** with documented behaviour, so the whole exchange can be tested
 * without a production secret. Verified against the live endpoint:
 *
 *     secret 1x0000000000000000000000000000000AA -> {"success": true}
 *     secret 2x0000000000000000000000000000000AA -> {"success": false,
 *                                    "error-codes":["invalid-input-response"]}
 *
 * The hCaptcha version of this could not be tested at all without a secret this
 * repository has no access to, which is why it was written and left switched
 * off.
 */
const SITEVERIFY =
  process.env.TURNSTILE_VERIFY_URL || 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

/**
 * The secret half. From the environment, or the gate does not run.
 *
 * Named to match the chatbot deployment, which already carries this exact value
 * in a deployed secrets list. `TURNSTILE_SECRET` is the better name for the
 * thing, but one convention for one shared secret beats a better name and two.
 */
const TURNSTILE_SECRET = process.env.CLOUDFLARE_SECRET_KEY || process.env.TURNSTILE_SECRET || '';

/**
 * The public half, handed to the browser when a challenge is required.
 *
 * Served from here rather than baked into the bundle, so a deployment can
 * change it without a rebuild and so the widget is only ever rendered when the
 * server actually wants one.
 */
const TURNSTILE_SITEKEY = process.env.CLOUDFLARE_SITE_KEY || process.env.TURNSTILE_SITEKEY || '';

/**
 * Whether a verified human is required. **On unless deliberately switched off.**
 *
 * This was an opt-in flag, and that was the wrong default. The chatbot team hit
 * precisely this: their captcha middleware treats "no secret configured" as "no
 * captcha to enforce", so a misconfiguration does not fail loudly -- it
 * silently disables the check. They also had a deployment where the secret WAS
 * present but arrived by a route the code did not read, and the gate stood open
 * with nothing anywhere saying so.
 *
 * An opt-in flag has the same shape: forget to set it and there is no check and
 * no complaint. So the default is now "required", and a deployment that does
 * not want it says so out loud with `ANSWER_REQUIRE_HUMAN=0`.
 *
 * The consequence is deliberate: a deployment that requires a human and has no
 * keys answers 503 and offers no AI answers at all. Losing the feature is the
 * correct failure. Silently answering without a check is not.
 */
const REQUIRE_HUMAN = process.env.ANSWER_REQUIRE_HUMAN !== '0';

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
 * The identity **and when its challenge was solved**, or null.
 *
 * `identityFromRequest` answers "is this a verified reader", which is all the
 * rate limiter needs. A presence claim needs more than that: a cookie is good
 * for twelve hours, and twelve hours after a challenge nobody can say a person
 * is still at the keyboard. The consumer decides how fresh is fresh enough, so
 * this reports the fact and holds no policy.
 *
 * The cookie carries an expiry rather than an issue time, so the issue time is
 * derived -- expiry minus the TTL that minted it. That is exact while
 * `IDENTITY_TTL_MS` is a constant, and it would drift the moment someone made
 * the TTL variable. If that ever happens, put the issue time in the cookie
 * instead of computing it here.
 */
function identityDetailsFromRequest(req, now = Date.now()) {
  const subject = identityFromRequest(req, now);
  if (!subject) return null;

  const match = new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`).exec(req.headers?.cookie || '');
  let value;
  try {
    value = decodeURIComponent(match[1]);
  } catch {
    return null;
  }
  const expiry = Number(value.split('.')[1]);
  if (!Number.isFinite(expiry)) return null;

  return { subject, solvedAt: expiry - IDENTITY_TTL_MS };
}

/**
 * Asks hCaptcha whether a response token is genuine.
 *
 * Failure of any kind is a failed verification. A network error here must not
 * become an accidental pass.
 */
async function verifyCaptcha(token, fetchImpl = fetch) {
  if (!TURNSTILE_SECRET || typeof token !== 'string' || token === '') return false;
  try {
    const response = await fetchImpl(SITEVERIFY, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ secret: TURNSTILE_SECRET, response: token }).toString(),
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
  return REQUIRE_HUMAN && (!TURNSTILE_SECRET || !IDENTITY_SECRET || !TURNSTILE_SITEKEY);
}

function setIdentityCookie(res, value) {
  res.append(
    'Set-Cookie',
    `${COOKIE}=${value}; Path=/; Max-Age=${Math.floor(IDENTITY_TTL_MS / 1000)}; HttpOnly; SameSite=Lax; Secure`
  );
}

module.exports = {
  COOKIE,
  SITEVERIFY,
  TURNSTILE_SITEKEY,
  IDENTITY_TTL_MS,
  REQUIRE_HUMAN,
  identityDetailsFromRequest,
  identityFromRequest,
  mintIdentity,
  misconfigured,
  readIdentity,
  setIdentityCookie,
  sign,
  verifyCaptcha,
};
