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
 * An EdDSA JWT, assembled here rather than with a library.
 *
 * Node signs Ed25519 natively and a JWT is two base64url segments and a
 * signature, so a dependency would be carrying a parser we never use -- and
 * this file is loaded by the process that serves the site.
 */
function mintCallerToken(key, subject) {
  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: 'EdDSA', typ: 'JWT' }));
  const payload = base64url(
    JSON.stringify({
      iss: ISSUER,
      aud: AUDIENCE,
      iat: now,
      exp: now + TOKEN_TTL_SECONDS,
      sub: subject,
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
      res.status(401).json({ detail: 'Verification required', verify: `${route}/verify` });
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
          caller_token: mintCallerToken(key, callerSubject(req, res)),
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

module.exports = {
  mountSearchAnswerProxy,
  mintCallerToken,
  retryAfter,
  clientKey,
  LIMITS,
  GLOBAL_LIMIT,
  // Test-only: the counters are process-wide, so a spec needs to start clean.
  __resetLimits: () => {
    seen.clear();
    globalCalls = [];
  },
  KEY_PATH,
  UPSTREAM,
  USER_AGENT,
  AUDIENCE,
  ISSUER,
};
