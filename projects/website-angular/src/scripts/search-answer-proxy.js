/**
 * Server side of the search page's AI answer.
 *
 * The browser posts a question here; this mints a caller token, asks the
 * chatbot, and streams its server-sent events straight back. The browser never
 * sees a key and never reaches the chatbot, which is the whole reason this
 * exists (`specs/005-search-page-answers/research.md`, D1 and D3).
 *
 * Three things that are not obvious and each cost something to find out:
 *
 *   * **An explicit User-Agent is required.** nginx blocks some clients at the
 *     edge before they reach the chatbot: a default library agent such as
 *     `python-httpx/0.27` gets a 403 with an HTML body, while curl and browsers
 *     get 200. A 403 shaped like HTML looks nothing like the contract -- no
 *     `done` event, no JSON -- so it reads as a token or audience fault.
 *   * **`aud` must be exactly `reactome-chatbot`.** They expect it and refuse a
 *     token carrying anything else, or none.
 *   * **The response is always HTTP 200.** The outcome is in the `done` event's
 *     `state`, never in a status code, so this must not translate anything into
 *     an HTTP error. Verified end to end on 18 Sep 2026: a token minted with
 *     our key returned `{"state": "answered", "seconds": 23.0}` with real
 *     stable identifiers.
 *
 * The signing key is read from disk at first use, not at startup: a missing key
 * must not stop the site from serving. Without one this answers 503 and the
 * panel renders nothing, which is the same outcome as any other failure.
 */
const crypto = require('node:crypto');
const express = require('express');
const gate = require('./human-gate');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

/** Where the Ed25519 private half lives. Never in the repository. */
const KEY_PATH =
  process.env.CALLER_TOKEN_KEY || path.join(os.homedir(), '.reactome/caller-token-ed25519.key');

const UPSTREAM = process.env.ANSWER_UPSTREAM || 'https://beta.reactome.org/chat/guest/api/answer';

/** Identifies us to their edge. Anything library-default gets a 403. */
const USER_AGENT = 'reactome-website/1.0 (+https://reactome.org)';

const AUDIENCE = 'reactome-chatbot';
const ISSUER = 'reactome-website';

/** Short, because a token is minted per request and never stored. */
const TOKEN_TTL_SECONDS = 120;

/**
 * How recently a challenge must have been solved for the token to say a person
 * is present.
 *
 * Not the same as the identity cookie's own life, which is twelve hours. The
 * cookie answers "has this browser proved itself", which is what a rate limiter
 * wants. A presence claim answers "is somebody there now", and twelve hours
 * after a challenge nobody can say that. An HMAC cookie is a bearer credential,
 * so a long-lived presence claim is a durable bot pass with extra steps.
 *
 * Thirty minutes, agreed with the chatbot side, which refuses the claim past
 * the same bound. It fails at both ends on purpose: neither of us is the only
 * thing standing between a stolen cookie and a model call. If it is ever
 * raised, raise it in both places in one change.
 *
 * Compared in **whole seconds**, because that is the precision the claim has.
 * `human_iat` is epoch seconds, so a bound enforced in milliseconds here would
 * be finer than anything the other end can see: they check
 * `now - human_iat <= 1800` against a value already rounded down. A challenge
 * solved 1800.4s ago presents as 1800 and is accepted at both ends. That is the
 * agreed behaviour rather than a discovered one -- an earlier test pinned
 * 1800.000 against 1800.001 and was measuring the test harness, since no claim
 * can express the difference.
 */
const HUMAN_CLAIM_MAX_AGE_SECONDS = 30 * 60;

/**
 * Our own ceiling, above their stated 120s.
 *
 * They give up at 120s and say so in a `done` event. A dropped connection says
 * nothing at all, so without this a request could hang indefinitely.
 */
const UPSTREAM_TIMEOUT_MS = 130_000;

const base64url = (input) => Buffer.from(input).toString('base64url');

let cachedKey = null;

function signingKey() {
  if (cachedKey !== null) return cachedKey;
  try {
    cachedKey = crypto.createPrivateKey(fs.readFileSync(KEY_PATH));
  } catch (error) {
    // Logged once, then remembered as absent: a missing key is a deployment
    // state rather than a per-request problem, and logging it per request would
    // bury everything else.
    console.error(`[answer] no caller-token key at ${KEY_PATH}: ${error.message}`);
    cachedKey = false;
  }
  return cachedKey;
}

/**
 * Whether a challenge was solved recently enough to say somebody is here.
 *
 * Its own function because two places need the *same* answer: the token minted
 * below, and the summary route's decision to challenge rather than forward.
 * While this was inline, only the token knew, and the route forwarded a request
 * whose claim it had not looked at -- so a reader with a live identity cookie
 * and a stale challenge was sent upstream to be refused `no_human`, with no way
 * back except a different page. Two copies of this rule could drift into
 * challenging a caller we would have served, or forwarding one we know will be
 * refused; one copy cannot.
 *
 * `age >= 0` as well as the upper bound. A challenge solved in the future is a
 * clock that moved, not a person: nobody can forge it -- the cookie is signed
 * here -- but a backwards step on this host would otherwise make every stale
 * cookie read as fresh, which is the one direction that matters.
 *
 * Whole seconds, because that is the precision `human_iat` has and the
 * precision the other end compares at.
 */
function presenceIsFresh(presence, now = Date.now()) {
  if (!presence) return false;
  const age = Math.floor(now / 1000) - Math.floor(presence.solvedAt / 1000);
  return age >= 0 && age <= HUMAN_CLAIM_MAX_AGE_SECONDS;
}

/**
 * An EdDSA JWT, assembled here rather than with a library.
 *
 * Node signs Ed25519 natively and a JWT is two base64url segments and a
 * signature, so a dependency would be carrying a parser we never use -- and
 * this file is loaded by the process that serves the site.
 */
function mintCallerToken(key, subject, presence = null, now = Date.now()) {
  const seconds = Math.floor(now / 1000);
  const header = base64url(JSON.stringify({ alg: 'EdDSA', typ: 'JWT' }));

  // `human` is present or absent, never false. A caller that failed the gate
  // and a caller that never met it are the same thing to whoever reads this,
  // and a `false` invites a check that treats "absent" as "not stated" and
  // lets it through.
  const solvedAtSeconds = presence ? Math.floor(presence.solvedAt / 1000) : 0;
  const fresh = presenceIsFresh(presence, now);
  // `human_sub` rather than reusing `sub`, even though both currently hold the
  // same value. `sub` is whatever `callerSubject` decided -- the verified
  // identity when there is one, a per-visit cookie when there is not -- and
  // their answer endpoint's limiter keys on it. `human_sub` is specifically the
  // identity cookie's subject, so their summary limiter can key on the durable
  // one without either endpoint's meaning depending on which branch
  // `callerSubject` happened to take.
  //
  // They will be equal while `callerSubject` prefers the verified identity, and
  // nothing should test that they are: agreement between two claims that mean
  // different things is a coincidence, and pinning it would make the separation
  // stop being real.
  const claims = fresh
    ? {
        human: true,
        human_iat: solvedAtSeconds,
        human_sub: presence.subject,
      }
    : undefined;

  const payload = base64url(
    JSON.stringify({
      iss: ISSUER,
      aud: AUDIENCE,
      iat: seconds,
      exp: seconds + TOKEN_TTL_SECONDS,
      sub: subject,
      ...claims,
    })
  );
  const signature = crypto
    .sign(null, Buffer.from(`${header}.${payload}`), key)
    .toString('base64url');
  return `${header}.${payload}.${signature}`;
}

/**
 * A stable-per-visit, opaque caller identity.
 *
 * Their rate limiter keys on `sub` when present, so this is what makes the four
 * questions of one reading session count as one caller. It is 128 random bits
 * in an HttpOnly cookie and is not derived from anything about the reader --
 * no address, no IP hash. Neither is personal data we hold, and we are not
 * going to start.
 */
function callerSubject(req, res) {
  // A verified identity, when there is one, is the honest answer: it is signed
  // by us, so the caller cannot choose or rotate it. The fallback below is not
  // -- it is a random value the browser hands back, which bounds a cooperating
  // reader and nothing else. See human-gate.js.
  const verified = gate.identityFromRequest(req);
  if (verified) return verified;

  const existing = /(?:^|;\s*)ra_sub=([0-9a-f]{32})(?:;|$)/.exec(req.headers.cookie || '');
  if (existing) return existing[1];
  const subject = crypto.randomBytes(16).toString('hex');
  res.append(
    'Set-Cookie',
    `ra_sub=${subject}; Path=/; Max-Age=86400; HttpOnly; SameSite=Lax; Secure`
  );
  return subject;
}

/**
 * A per-caller limit, because nothing else constrains this route.
 *
 * The route is public, unauthenticated, and every call costs a model
 * completion of roughly sixteen seconds. Before this there was nothing between
 * a script and unlimited spend: nginx lets `/` through at 100 r/s, the
 * user-agent block is one header away from bypassed, and the opt-in click in
 * the UI only deters crawlers, which do not click.
 *
 * Keyed on the client address rather than on the `sub` cookie, and that
 * distinction is the point. `sub` is set by us and returned by the browser, so
 * a caller that ignores cookies presents a new one every request -- which
 * defeats the chatbot's own limiter, since it keys on `sub`. An identifier the
 * caller chooses cannot limit the caller.
 *
 * This is a counter in memory, not a stored address: the key is discarded when
 * its window lapses, nothing is written down, and a restart forgets everything.
 * It is also not a proof of human. It bounds the cost of automation; it does not
 * prevent it. A real human gate needs a challenge, which is a product decision.
 */
const LIMITS = [
  { windowMs: 60_000, max: 5 },
  { windowMs: 3_600_000, max: 30 },
];

/**
 * A ceiling across all callers, because a per-caller key can be rotated.
 *
 * The per-address key comes from a header. Through Cloudflare that header is
 * overwritten and trustworthy, but a caller reaching the origin directly can
 * set it freely and present a new address every request -- the same flaw as the
 * `sub` cookie, one layer down. Any identifier the caller can influence bounds
 * nothing by itself.
 *
 * So the guarantee that does hold is this: whatever any one caller does, the
 * route cannot cost more than this many completions an hour. Generous for a
 * review surface, and finite. If it is ever reached readers get 429 and no
 * answers, which is the correct failure for an aside on a page whose actual
 * results are unaffected.
 */
const GLOBAL_LIMIT = { windowMs: 3_600_000, max: 120 };

const seen = new Map();
let globalCalls = [];

function clientKey(req) {
  // Behind Cloudflare and nginx, so the left-most forwarded address is the
  // client. Falls back to the socket for a direct call.
  const forwarded = (req.headers['cf-connecting-ip'] || req.headers['x-forwarded-for'] || '')
    .toString()
    .split(',')[0]
    .trim();
  return forwarded || req.socket?.remoteAddress || 'unknown';
}

/** Returns the seconds to wait, or 0 when the call is allowed. */
function retryAfter(key, now = Date.now()) {
  globalCalls = globalCalls.filter((at) => now - at < GLOBAL_LIMIT.windowMs);
  if (globalCalls.length >= GLOBAL_LIMIT.max) {
    return Math.ceil((GLOBAL_LIMIT.windowMs - (now - globalCalls[0])) / 1000);
  }

  const times = (seen.get(key) ?? []).filter((at) => now - at < LIMITS[LIMITS.length - 1].windowMs);

  for (const { windowMs, max } of LIMITS) {
    const inWindow = times.filter((at) => now - at < windowMs);
    if (inWindow.length >= max) {
      seen.set(key, times);
      return Math.ceil((windowMs - (now - inWindow[0])) / 1000);
    }
  }

  times.push(now);
  seen.set(key, times);
  globalCalls.push(now);
  // Opportunistic sweep: without it the map grows for every address ever seen.
  if (seen.size > 5000) {
    const cutoff = now - LIMITS[LIMITS.length - 1].windowMs;
    for (const [at, stamps] of seen) {
      if (stamps.every((stamp) => stamp < cutoff)) seen.delete(at);
    }
  }
  return 0;
}

/**
 * A separate budget for verification attempts.
 *
 * The answer route's limits do not cover this one, and without it the exchange
 * is free to hammer: every attempt costs us an outbound call to hCaptcha, so an
 * attacker could exhaust our verification quota or get us blocked there while
 * spending nothing. Found reviewing this before it shipped.
 *
 * Kept apart from the answer budget on purpose. Sharing it would let failed
 * verification attempts consume the allowance for answering, which turns a
 * cheap nuisance into a denial of the actual feature.
 */
const VERIFY_LIMITS = [
  { windowMs: 60_000, max: 10 },
  { windowMs: 3_600_000, max: 60 },
];
const VERIFY_GLOBAL = { windowMs: 3_600_000, max: 600 };

const verifySeen = new Map();
let verifyGlobal = [];

function verifyRetryAfter(key, now = Date.now()) {
  verifyGlobal = verifyGlobal.filter((at) => now - at < VERIFY_GLOBAL.windowMs);
  if (verifyGlobal.length >= VERIFY_GLOBAL.max) {
    return Math.ceil((VERIFY_GLOBAL.windowMs - (now - verifyGlobal[0])) / 1000);
  }

  const times = (verifySeen.get(key) ?? []).filter(
    (at) => now - at < VERIFY_LIMITS[VERIFY_LIMITS.length - 1].windowMs
  );
  for (const { windowMs, max } of VERIFY_LIMITS) {
    const inWindow = times.filter((at) => now - at < windowMs);
    if (inWindow.length >= max) {
      verifySeen.set(key, times);
      return Math.ceil((windowMs - (now - inWindow[0])) / 1000);
    }
  }

  times.push(now);
  verifySeen.set(key, times);
  verifyGlobal.push(now);
  if (verifySeen.size > 5000) {
    const cutoff = now - VERIFY_LIMITS[VERIFY_LIMITS.length - 1].windowMs;
    for (const [at, stamps] of verifySeen) {
      if (stamps.every((stamp) => stamp < cutoff)) verifySeen.delete(at);
    }
  }
  return 0;
}

/** Mounts POST <route> on an Express app. */
function mountSearchAnswerProxy(app, route = '/search-answer') {
  // Exchanges a solved captcha for a signed identity. This is the only way to
  // obtain one, which is what makes a fresh rate-limit bucket cost a challenge
  // rather than nothing.
  app.post(`${route}/verify`, express.json({ limit: '8kb' }), async (req, res) => {
    if (gate.misconfigured()) {
      res.status(503).json({ detail: 'Verification is not configured on this deployment' });
      return;
    }
    const verifyWait = verifyRetryAfter(clientKey(req));
    if (verifyWait > 0) {
      res.setHeader('Retry-After', String(verifyWait));
      res.status(429).json({ detail: 'Too many verification attempts. Try again shortly.' });
      return;
    }

    const ok = await gate.verifyCaptcha(req.body?.captchaToken);
    if (!ok) {
      res.status(400).json({ detail: 'Verification failed' });
      return;
    }
    gate.setIdentityCookie(res, gate.mintIdentity());
    res.status(204).end();
  });

  // A question is a short string; nothing here needs a large body.
  app.post(route, express.json({ limit: '4kb' }), async (req, res) => {
    const question = typeof req.body?.question === 'string' ? req.body.question.trim() : '';
    if (!question) {
      res.status(400).json({ detail: 'A question is required' });
      return;
    }

    // A gate that is switched on but cannot verify must refuse, not wave
    // callers through: silently becoming decorative is the failure it exists to
    // prevent.
    if (gate.misconfigured()) {
      console.error('[answer] ANSWER_REQUIRE_HUMAN is set but the gate is not configured');
      res.status(503).json({ detail: 'Answers are not configured on this deployment' });
      return;
    }

    const verified = gate.identityFromRequest(req);
    if (gate.REQUIRE_HUMAN && !verified) {
      // The panel shows the challenge on this, then retries. 401 rather than
      // 403: the reader may become authorised by answering it.
      // The sitekey travels with the refusal, so the panel renders a widget only
      // when the server actually wants one and a deployment can change it
      // without a rebuild.
      res.status(401).json({
        detail: 'Verification required',
        verify: `${route}/verify`,
        sitekey: gate.TURNSTILE_SITEKEY,
      });
      return;
    }

    // Keyed on the verified identity when there is one, because that is the
    // only identifier here the caller cannot rotate.
    const wait = retryAfter(verified || clientKey(req));
    if (wait > 0) {
      res.setHeader('Retry-After', String(wait));
      res.status(429).json({ detail: 'Too many answer requests. Try again shortly.' });
      return;
    }

    const key = signingKey();
    if (!key) {
      res.status(503).json({ detail: 'Answers are not configured on this deployment' });
      return;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
    // The reader navigating away closes this connection, and closing the
    // connection is what cancels the work upstream -- their generator raises
    // and stops producing. So there is nothing else to tell them.
    res.on('close', () => controller.abort());

    try {
      const upstream = await fetch(UPSTREAM, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'text/event-stream',
          'User-Agent': USER_AGENT,
        },
        body: JSON.stringify({
          question,
          // The presence claim rides on the token because the identity cookie
          // cannot: it is same-site to this origin, and the chatbot is reached
          // from this server rather than from the browser. So what they can
          // verify is what we sign.
          caller_token: mintCallerToken(
            key,
            callerSubject(req, res),
            gate.identityDetailsFromRequest(req)
          ),
        }),
        signal: controller.signal,
      });

      if (!upstream.ok || !upstream.body) {
        console.error(`[answer] upstream ${upstream.status}`);
        res.status(502).json({ detail: 'Upstream unavailable' });
        return;
      }

      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache, no-transform');
      res.setHeader('Connection', 'keep-alive');
      // Belt and braces: nginx buffering here would turn a streamed answer into
      // twenty seconds of nothing followed by all of it at once.
      res.setHeader('X-Accel-Buffering', 'no');
      res.flushHeaders();

      for await (const chunk of upstream.body) {
        res.write(chunk);
      }
      res.end();
    } catch (error) {
      if (controller.signal.aborted) {
        res.end();
        return;
      }
      console.error(`[answer] ${error.message}`);
      if (!res.headersSent) res.status(502).json({ detail: 'Upstream unavailable' });
      else res.end();
    } finally {
      clearTimeout(timer);
    }
  });
}

/** Where the analysis summary lives. Same host and gate as the answer. */
const SUMMARY_UPSTREAM =
  process.env.SUMMARY_UPSTREAM || 'https://beta.reactome.org/chat/guest/api/analysis-summary';

/**
 * The tiers the summary service will build. `identifiers` names the unmatched
 * identifiers; `aggregate` describes the result without them.
 *
 * Checked here as well as there because a value outside the set is a 422 with a
 * JSON body rather than an SSE stream -- a different shape from every other
 * outcome, and one the panel would try to parse as events.
 */
const DISCLOSURES = ['aggregate', 'identifiers'];

/**
 * Server side of the analysis summary.
 *
 * The same shape as the answer above and for the same reason: the browser never
 * holds a key and never reaches the chatbot. What differs is the payload -- an
 * analysis token and a disclosure tier rather than a question -- and what the
 * stream can end with.
 *
 * **This proxy does not interpret the outcome.** Every terminal state arrives in
 * the `done` event with HTTP 200, and which one it is changes what the reader
 * should be offered rather than whether the request worked:
 *
 *   summarised   a summary was produced. Note the word: the answer endpoint
 *                above ends on `answered` and this one does not, and this
 *                comment said `answered` until a panel built from it rendered
 *                every good summary as "the summary could not be produced"
 *   gone         the result predates the current release -- **re-run it**, which
 *                is an action, and the only state where the reader can do
 *                something. Not the same as not_found, which is a dead end
 *   not_found    no such analysis
 *   unsupported  a ReactomeGSA result (GSA_REGULATION, GSA_STATISTICS, GSVA) --
 *                three of the six analysis types, so not rare
 *   refused      with a reason: no_caller, no_human, stale_human, rate_limited,
 *                unsupported_tier
 *
 * Collapsing any of those into "no summary" throws away the only useful thing
 * the service said, so they travel through untouched and the panel decides.
 */
function mountAnalysisSummaryProxy(app, route = '/analysis-summary') {
  app.post(route, express.json({ limit: '4kb' }), async (req, res) => {
    const token = typeof req.body?.token === 'string' ? req.body.token.trim() : '';
    const disclosure =
      typeof req.body?.disclosure === 'string' ? req.body.disclosure.trim() : 'aggregate';

    if (!token) {
      res.status(400).json({ detail: 'An analysis token is required' });
      return;
    }
    if (!DISCLOSURES.includes(disclosure)) {
      res.status(400).json({ detail: `disclosure must be one of: ${DISCLOSURES.join(', ')}` });
      return;
    }

    if (gate.misconfigured()) {
      console.error('[summary] ANSWER_REQUIRE_HUMAN is set but the gate is not configured');
      res.status(503).json({ detail: 'Summaries are not configured on this deployment' });
      return;
    }

    const verified = gate.identityFromRequest(req);
    // Unlike the answer route, which asks only whether this browser has ever
    // proved itself, this one asks whether somebody is here *now* -- because
    // that is what the endpoint behind it asks. It verifies `human` and
    // `human_iat` before any model call and refuses `no_human` without them,
    // measured rather than assumed: a caller token with no presence claim gets
    // a full answer from /api/answer and `{"state":"refused","reason":
    // "no_human"}` from /api/analysis-summary.
    //
    // So forwarding a request we know carries no fresh claim spends a round
    // trip to be told what we already knew, and hands the panel a refusal it
    // can do nothing with. The identity cookie lives twelve hours and a
    // presence claim thirty minutes, so this is not an edge case: it is every
    // reader who verified earlier in the morning. Challenging here means they
    // solve one widget where they are and get their summary.
    if (gate.REQUIRE_HUMAN && !presenceIsFresh(gate.identityDetailsFromRequest(req))) {
      res.status(401).json({
        detail: 'Verification required',
        verify: '/search-answer/verify',
        sitekey: gate.TURNSTILE_SITEKEY,
      });
      return;
    }

    // One budget for both routes, keyed the same way. A summary and an answer
    // cost the same upstream, and separate budgets would let a caller spend
    // twice by alternating.
    const wait = retryAfter(verified || clientKey(req));
    if (wait > 0) {
      res.setHeader('Retry-After', String(wait));
      res.status(429).json({ detail: 'Too many summary requests. Try again shortly.' });
      return;
    }

    const key = signingKey();
    if (!key) {
      res.status(503).json({ detail: 'Summaries are not configured on this deployment' });
      return;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
    res.on('close', () => controller.abort());

    try {
      const upstream = await fetch(SUMMARY_UPSTREAM, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'text/event-stream',
          'User-Agent': USER_AGENT,
        },
        body: JSON.stringify({
          token,
          disclosure,
          caller_token: mintCallerToken(
            key,
            callerSubject(req, res),
            gate.identityDetailsFromRequest(req)
          ),
        }),
        signal: controller.signal,
      });

      // 422 is the one outcome that is not a stream: a malformed disclosure is
      // rejected by validation before anything runs, so it has a JSON body and
      // no events. Passed through as itself rather than turned into a 502,
      // which would say "upstream is down" about a request we got wrong.
      if (upstream.status === 422) {
        const detail = await upstream.text();
        console.error(`[summary] upstream rejected the request: ${detail.slice(0, 200)}`);
        res.status(422).type('application/json').send(detail);
        return;
      }

      if (!upstream.ok || !upstream.body) {
        console.error(`[summary] upstream ${upstream.status}`);
        res.status(502).json({ detail: 'Upstream unavailable' });
        return;
      }

      res.setHeader('Content-Type', 'text/event-stream');
      res.setHeader('Cache-Control', 'no-cache, no-transform');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no');
      res.flushHeaders();

      for await (const chunk of upstream.body) {
        res.write(chunk);
      }
      res.end();
    } catch (error) {
      if (controller.signal.aborted) {
        res.end();
        return;
      }
      console.error(`[summary] ${error.message}`);
      if (!res.headersSent) res.status(502).json({ detail: 'Upstream unavailable' });
      else res.end();
    } finally {
      clearTimeout(timer);
    }
  });
}

module.exports = {
  mountSearchAnswerProxy,
  mountAnalysisSummaryProxy,
  HUMAN_CLAIM_MAX_AGE_SECONDS,
  presenceIsFresh,
  mintCallerToken,
  retryAfter,
  verifyRetryAfter,
  clientKey,
  LIMITS,
  GLOBAL_LIMIT,
  // Test-only: the counters are process-wide, so a spec needs to start clean.
  VERIFY_LIMITS,
  VERIFY_GLOBAL,
  __resetLimits: () => {
    seen.clear();
    globalCalls = [];
    verifySeen.clear();
    verifyGlobal = [];
  },
  KEY_PATH,
  UPSTREAM,
  USER_AGENT,
  AUDIENCE,
  ISSUER,
};
